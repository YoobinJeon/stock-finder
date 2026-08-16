import { unzipSync } from 'fflate';
import { http } from '../http';
import { logger } from '../../utils/logger';

/**
 * DART 고유번호(corp_code) 매핑 — `corpCode.xml` 다운로드.
 *
 * DART 재무 API는 ticker를 받지 않고 8자리 corp_code로만 조회된다. 매핑은 이 zip 하나로만
 * 얻을 수 있다(에서 선행 작업으로 기록해둔 것). 응답은 단일 엔트리 zip(CORPCODE.xml,
 * 약 30MB)이라 프로젝트에 이미 있는 `fflate`로 푼다.
 *
 * 실측(2026-07-29): 전체 118,562건 중 stock_code가 있는 상장사 3,981건 — 활성 2,766종목을 덮는다.
 */

const CORP_CODE_URL = 'https://opendart.fss.or.kr/api/corpCode.xml';

/** 6자리 종목코드 → 8자리 DART 고유번호 */
export type CorpCodeMap = Map<string, string>;

/**
 * `CORPCODE.xml` → 종목코드 매핑 (순수 함수 — 네트워크 없음).
 *
 * 30MB XML을 DOM으로 올리지 않고 `<list>` 블록 단위로 훑는다. `stock_code`가 비었거나
 * 6자리가 아닌 항목(비상장·폐지)은 버리고, 같은 종목코드가 중복되면 **첫 항목을 유지**한다
 * (파일이 대체로 오래된 것부터 나오지 않으므로 뒤에서 덮어쓰면 폐지 법인이 이길 수 있다).
 */
export function parseCorpCodeXml(xml: string): CorpCodeMap {
  const map: CorpCodeMap = new Map();
  const blocks = xml.match(/<list>[\s\S]*?<\/list>/g) ?? [];
  for (const block of blocks) {
    const stockCode = /<stock_code>([^<]*)<\/stock_code>/.exec(block)?.[1]?.trim();
    const corpCode = /<corp_code>([^<]*)<\/corp_code>/.exec(block)?.[1]?.trim();
    if (!stockCode || stockCode.length !== 6 || !corpCode) continue;
    if (!map.has(stockCode)) map.set(stockCode, corpCode);
  }
  return map;
}

/**
 * 종목코드 → corp_code. **우선주 폴백**을 포함한다.
 *
 * 우선주(예: 삼성전자우 005935)는 DART에 자기 고유번호가 없다 — 공시 주체가 보통주와 같은
 * 법인이기 때문이다. KRX 관례상 보통주는 끝자리가 `0`이고 우선주는 5·7·9 등이므로,
 * 매핑에 없고 끝자리가 `0`이 아니면 `앞 5자리 + '0'`으로 한 번 더 찾는다. 재무가 같은
 * 법인이라 이 대체는 **의도된 동일 매핑**이다(우선주만 이력이 얕아지는 것을 막는다).
 */
export function resolveCorpCode(map: CorpCodeMap, ticker: string): string | null {
  const direct = map.get(ticker);
  if (direct) return direct;
  if (ticker.length === 6 && !ticker.endsWith('0')) {
    return map.get(`${ticker.slice(0, 5)}0`) ?? null;
  }
  return null;
}

/**
 * corpCode.xml(zip) 다운로드 후 매핑 반환. 실패 시 예외를 던진다 — 이 매핑이 없으면
 * DART 분기 백필 자체가 불가능하므로 조용히 빈 맵을 돌려주면 "0건 백필"로 오해된다.
 */
export async function fetchCorpCodeMap(apiKey: string): Promise<CorpCodeMap> {
  const { data } = await http.get(CORP_CODE_URL, {
    params: { crtfc_key: apiKey },
    responseType: 'arraybuffer',
    timeout: 60000,
  });

  const files = unzipSync(new Uint8Array(data));
  const entry = Object.keys(files).find((n) => /CORPCODE\.xml$/i.test(n));
  if (!entry) {
    // 키가 틀리면 zip 대신 XML 에러 응답이 온다 — 그 경우 unzipSync가 이미 던진다.
    throw new Error(`corpCode.xml 엔트리를 찾을 수 없습니다 (받은 항목: ${Object.keys(files).join(', ')})`);
  }

  const map = parseCorpCodeXml(Buffer.from(files[entry]).toString('utf8'));
  logger.info(`DART 고유번호 매핑: 상장 종목 ${map.size}건`);
  return map;
}
