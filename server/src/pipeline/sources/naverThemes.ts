import axios from 'axios';
import iconv from 'iconv-lite';
import { getDb } from '../../config/database';
import { sleep } from '../http';
import { logger } from '../../utils/logger';

/**
 * 네이버 테마 페이지 스크레이핑 (EUC-KR HTML).
 * - 목록: sise_group.naver?type=theme — 한 요청에 전체(~266개) 반환 (page 파라미터 무시 — 2026-07 실측)
 * - 상세: sise_group_detail.naver?type=theme&no=N — 구성종목 (main.naver?code= 앵커)
 * 테마명·구성종목은 DB 스냅샷으로 저장하고, 등락률·상승/하락 수는 라이브(60초 캐시)로 쓴다.
 */

const THEME_URL = 'https://finance.naver.com/sise/sise_group.naver?type=theme';
const THEME_DETAIL_URL = 'https://finance.naver.com/sise/sise_group_detail.naver';
const CACHE_TTL = 60 * 1000;

const http = axios.create({
  headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  responseType: 'arraybuffer',
  timeout: 15000,
});

export interface ThemeLive {
  no: number;      // 네이버 테마 번호
  name: string;
  chgPct: number;  // 오늘 등락률 (%)
  total: number;   // 전체 종목수
  up: number;      // 상승
  down: number;    // 하락
}

/**
 * 테마 목록 HTML → ThemeLive 배열 (순수 함수).
 * 행: <a ...type=theme&no=N">테마명</a> … <span class="tah…">±X.XX%</span> … 전체·상승·보합·하락 4개 숫자 td.
 */
export function parseThemeList(html: string): ThemeLive[] {
  const rowRe =
    /sise_group_detail\.naver\?type=theme&no=(\d+)">([^<]+)<\/a>[\s\S]*?<span class="tah[^"]*">\s*([+\-]?[\d.]+)%\s*<\/span>\s*<\/td>\s*<td class="number">(\d+)<\/td>\s*<td class="number">(\d+)<\/td>\s*<td class="number">(\d+)<\/td>\s*<td class="number">(\d+)<\/td>/g;
  const out: ThemeLive[] = [];
  const seen = new Set<number>();
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html)) !== null) {
    const no = Number(m[1]);
    if (seen.has(no)) continue;
    seen.add(no);
    // m[6] = 보합(사용 안 함)
    out.push({
      no,
      name: m[2].trim(),
      chgPct: Number(m[3]),
      total: Number(m[4]),
      up: Number(m[5]),
      down: Number(m[7]),
    });
  }
  return out;
}

let cache: { list: ThemeLive[]; at: number } | null = null;

/** 테마 전체 라이브 목록. 60초 캐시, 실패 시 이전 캐시 또는 빈 배열 (fail-soft). */
export async function fetchThemeListLive(): Promise<ThemeLive[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL) return cache.list;
  try {
    const res = await http.get(THEME_URL);
    const list = parseThemeList(iconv.decode(Buffer.from(res.data), 'euc-kr'));
    if (list.length > 0) cache = { list, at: Date.now() };
    return list;
  } catch {
    return cache?.list ?? [];
  }
}

/** 테마 구성종목 티커 목록 (naverSectors.fetchSectorTickers와 동일 패턴, 3회 재시도) */
async function fetchThemeMembers(no: number): Promise<string[]> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await http.get(THEME_DETAIL_URL, { params: { type: 'theme', no } });
      const html = iconv.decode(Buffer.from(res.data), 'euc-kr');
      const re = /main\.naver\?code=(\d{6})/g;
      const tickers: string[] = [];
      const seen = new Set<string>();
      let m: RegExpExecArray | null;
      while ((m = re.exec(html)) !== null) {
        if (!seen.has(m[1])) {
          seen.add(m[1]);
          tickers.push(m[1]);
        }
      }
      return tickers;
    } catch {
      if (attempt < 2) await sleep(1000 * (attempt + 1));
    }
  }
  return [];
}

/**
 * 테마 스냅샷 갱신: 목록 → 테마별 구성종목 수집(배치 3 + 200ms 페이싱, ~266요청 2~3분)
 * → themes/theme_members 업서트, 사라진 테마는 삭제.
 */
export async function refreshThemeSnapshot(): Promise<{ themes: number; members: number }> {
  const db = getDb();
  const list = await fetchThemeListLive();
  if (list.length === 0) throw new Error('테마 목록을 가져오지 못했습니다 (네이버 응답 없음)');

  let memberCount = 0;
  const BATCH = 3;
  for (let i = 0; i < list.length; i += BATCH) {
    const batch = list.slice(i, i + BATCH);
    await Promise.all(
      batch.map(async (t) => {
        const tickers = await fetchThemeMembers(t.no);
        await db.query(
          `INSERT INTO themes (theme_no, name, updated_at) VALUES ($1, $2, now())
           ON CONFLICT (theme_no) DO UPDATE SET name = EXCLUDED.name, updated_at = now()`,
          [t.no, t.name],
        );
        await db.query('DELETE FROM theme_members WHERE theme_no = $1', [t.no]);
        for (const ticker of tickers) {
          await db.query(
            'INSERT INTO theme_members (theme_no, ticker) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [t.no, ticker],
          );
        }
        memberCount += tickers.length;
      }),
    );
    await sleep(200);
  }

  // 이번 수집에 없는 테마는 폐지된 것 — 제거 (CASCADE로 멤버도 삭제)
  await db.query('DELETE FROM themes WHERE theme_no <> ALL($1::int[])', [list.map((t) => t.no)]);

  logger.info(`테마 스냅샷 갱신 완료: ${list.length}개 테마, ${memberCount}개 구성종목`);
  return { themes: list.length, members: memberCount };
}
