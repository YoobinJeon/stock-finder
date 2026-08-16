import type { Db } from '../config/database';
import { logger } from '../utils/logger';

/**
 * 업종·테마별 대표 ETF (차트보드용 큐레이션 — 2026-07-10 라이브 목록에서 티커 검증).
 * 이름·시세는 응답 시점의 라이브 목록에서 다시 조회하므로 이름 변경에도 안전.
 * etf.routes.ts(차트보드)·etfPhaseSnapshot.ts(국면 이력 적재)가 공유 — 순환 임포트 방지를 위해
 * 별도 모듈로 분리.
 */
export const REPRESENTATIVE_ETFS: Array<{ ticker: string; group: string }> = [
  { ticker: '069500', group: '시장' },        // KODEX 200
  { ticker: '229200', group: '시장' },        // KODEX 코스닥150
  { ticker: '091160', group: '업종' },        // KODEX 반도체
  { ticker: '305720', group: '업종' },        // KODEX 2차전지산업
  { ticker: '091180', group: '업종' },        // KODEX 자동차
  { ticker: '091170', group: '업종' },        // KODEX 은행
  { ticker: '102970', group: '업종' },        // KODEX 증권
  { ticker: '244580', group: '업종' },        // KODEX 바이오
  { ticker: '143860', group: '업종' },        // TIGER 헬스케어
  { ticker: '117680', group: '업종' },        // KODEX 철강
  { ticker: '117700', group: '업종' },        // KODEX 건설
  { ticker: '117460', group: '업종' },        // KODEX 에너지화학
  { ticker: '139260', group: '업종' },        // TIGER 200 IT
  { ticker: '487240', group: '업종' },        // KODEX AI전력핵심설비 (전력기기)
  { ticker: '365000', group: '업종' },        // TIGER 인터넷TOP10
  { ticker: '464610', group: '업종' },        // SOL 의료기기소부장Fn
  { ticker: '438900', group: '업종' },        // HANARO Fn K-푸드 (음식료)
  { ticker: '449450', group: '테마' },        // PLUS K방산
  { ticker: '466920', group: '테마' },        // SOL 조선TOP3플러스
  { ticker: '300950', group: '테마' },        // KODEX 게임산업
  { ticker: '445290', group: '테마' },        // KODEX 로봇액티브
  { ticker: '395160', group: '테마' },        // KODEX AI반도체TOP2플러스
  { ticker: '434730', group: '테마' },        // HANARO 원자력iSelect
  { ticker: '385510', group: '테마' },        // KODEX 신재생에너지액티브
  { ticker: '228790', group: '테마' },        // TIGER 화장품
  { ticker: '228800', group: '테마' },        // TIGER 여행레저
  { ticker: '395290', group: '테마' },        // HANARO Fn K-POP&미디어 (엔터)
  { ticker: '228810', group: '테마' },        // TIGER 미디어컨텐츠 (드라마·콘텐츠)
  { ticker: '360750', group: '해외·원자재' }, // TIGER 미국S&P500
  { ticker: '371460', group: '해외·원자재' }, // TIGER 차이나전기차SOLACTIVE
  { ticker: '132030', group: '해외·원자재' }, // KODEX 골드선물(H)
];

/**
 * 사용자 차트보드 커스텀 구성 — 기본 큐레이션(REPRESENTATIVE_ETFS)에 대한 오버레이.
 * added: 사용자가 추가한 종목(그룹 지정), removed: 기본 큐레이션에서 제거한 티커.
 * app_settings 테이블에 key='etf_board_config'로 JSON 저장 (013 마이그레이션, 신규 마이그레이션 불필요).
 */
export interface EtfBoardConfig {
  added: Array<{ ticker: string; group: string }>;
  removed: string[];
}

const EMPTY_BOARD_CONFIG: EtfBoardConfig = { added: [], removed: [] };
const BOARD_CONFIG_KEY = 'etf_board_config';

const TICKER_RE = /^[0-9A-Z]{6}$/;
const MAX_ADDED = 30;
const MAX_GROUP_LEN = 20;

/**
 * 기본 큐레이션 + 사용자 구성을 병합한 실효 종목 목록 (순수함수).
 * removed에 포함된 기본 종목은 제외, added는 순서 유지하며 뒤에 append.
 * 중복 티커(기본 목록에도 있고 added에도 있는 경우)는 added 쪽 정의가 우선하도록
 * 기본 목록에서는 제거하고 added의 항목만 남긴다.
 */
export function mergeBoardList(
  defaults: Array<{ ticker: string; group: string }>,
  config: EtfBoardConfig,
): Array<{ ticker: string; group: string }> {
  const removedSet = new Set(config.removed);
  const addedTickerSet = new Set(config.added.map((a) => a.ticker));
  const kept = defaults.filter(
    (d) => !removedSet.has(d.ticker) && !addedTickerSet.has(d.ticker),
  );
  return [...kept, ...config.added];
}

/**
 * PUT /etf/board-config 요청 바디 검증 (순수함수).
 * added는 최대 30개, ticker는 6자리 영문대문자·숫자, group은 1~20자 문자열.
 * removed는 6자리 티커 문자열 배열. 위반 시 null.
 */
export function parseBoardConfig(body: unknown): EtfBoardConfig | null {
  if (!body || typeof body !== 'object') return null;
  const { added, removed } = body as { added?: unknown; removed?: unknown };
  if (!Array.isArray(added) || !Array.isArray(removed)) return null;
  if (added.length > MAX_ADDED) return null;

  const parsedAdded: Array<{ ticker: string; group: string }> = [];
  for (const item of added) {
    if (!item || typeof item !== 'object') return null;
    const { ticker, group } = item as { ticker?: unknown; group?: unknown };
    if (typeof ticker !== 'string' || !TICKER_RE.test(ticker)) return null;
    if (typeof group !== 'string' || group.length < 1 || group.length > MAX_GROUP_LEN) return null;
    parsedAdded.push({ ticker, group });
  }

  const parsedRemoved: string[] = [];
  for (const ticker of removed) {
    if (typeof ticker !== 'string' || !TICKER_RE.test(ticker)) return null;
    parsedRemoved.push(ticker);
  }

  return { added: parsedAdded, removed: parsedRemoved };
}

/**
 * app_settings에서 사용자 구성을 읽는다. 미저장 상태면 빈 구성, JSON 파싱 실패 시
 * 빈 구성 + warn 로그 (기본 큐레이션으로 폴백 — 구성 손상이 보드 전체를 막지 않게).
 */
export async function getBoardConfig(db: Db): Promise<EtfBoardConfig> {
  const { rows } = await db.query(
    'SELECT value FROM app_settings WHERE key = $1',
    [BOARD_CONFIG_KEY],
  );
  if (rows.length === 0) return EMPTY_BOARD_CONFIG;

  try {
    const parsed = JSON.parse(rows[0].value);
    const added = Array.isArray(parsed?.added) ? parsed.added : [];
    const removed = Array.isArray(parsed?.removed) ? parsed.removed : [];
    return { added, removed };
  } catch (err) {
    logger.warn(`etf_board_config JSON 파싱 실패 — 기본 큐레이션으로 폴백: ${String(err)}`);
    return EMPTY_BOARD_CONFIG;
  }
}

/** 기본 큐레이션 + 저장된 사용자 구성을 병합한 차트보드 실효 목록. */
export async function getEffectiveBoardList(
  db: Db,
): Promise<Array<{ ticker: string; group: string }>> {
  const config = await getBoardConfig(db);
  return mergeBoardList(REPRESENTATIVE_ETFS, config);
}
