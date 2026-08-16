/**
 * 월간 상승률 — 매트릭스의 **행을 무엇으로 묶을지**를 정하는 축.
 *
 * 테마와 산업은 성격이 다르다.
 *   테마 — 다대다. 한 종목이 여러 테마에 들어가고, 266개 테마가 서로 겹친다.
 *   산업 — 일대다. `stocks.sector` 한 칸이라 전 종목이 겹침 없이 갈린다(분류 없는 종목은 빠진다).
 * 겹침 여부만 다를 뿐 "멤버 수익률 → 대표값"으로 압축하는 방식은 같아서, 축만 갈아 끼운다.
 *
 * ⚠️ **두 축 모두 시점 정보가 없다.** 테마 구성도 산업 분류도 현재 한 벌뿐이라 과거 달이
 * 오늘 구성으로 소급 계산된다. 화면에서 이 한계를 밝힌다.
 */

export const AXES = ['theme', 'sector'] as const;
export type Axis = (typeof AXES)[number];

export const DEFAULT_AXIS: Axis = 'theme';

export function parseAxis(value: unknown): Axis | null {
  return (AXES as readonly string[]).includes(String(value)) ? (String(value) as Axis) : null;
}

export interface Group {
  /** URL·정렬에 쓰는 식별자. 테마는 테마번호 문자열, 산업은 산업명 자체. */
  key: string;
  name: string;
  /** 멤버 티커 — **활성 종목만**. 상장폐지 종목까지 세면 분모가 부풀어 보인다. */
  tickers: string[];
}

/** 묶음을 만드는 데 필요한 종목 정보는 산업뿐이다 — 스냅샷의 `StockMeta`가 그대로 들어온다. */
export interface ActiveStock {
  sector: string | null;
}

export interface GroupSource {
  /** 테마번호 → 멤버 티커(상장폐지 포함 원본). */
  members: ReadonlyMap<number, readonly string[]>;
  themeNames: ReadonlyMap<number, string>;
  /** **활성 종목만** 담긴 맵 — 키가 있다는 것 자체가 "상장 유지"를 뜻한다. */
  stocks: ReadonlyMap<string, ActiveStock>;
}

/**
 * 축에 맞는 묶음 목록. 키 순서는 정하지 않는다 — 정렬은 화면 몫이다.
 */
export function buildGroups(axis: Axis, source: GroupSource): Map<string, Group> {
  return axis === 'sector' ? buildSectorGroups(source) : buildThemeGroups(source);
}

function buildThemeGroups({ members, themeNames, stocks }: GroupSource): Map<string, Group> {
  const groups = new Map<string, Group>();
  for (const [themeNo, tickers] of members) {
    const active = tickers.filter((t) => stocks.has(t));
    if (active.length === 0) continue;
    const key = String(themeNo);
    groups.set(key, { key, name: themeNames.get(themeNo) ?? key, tickers: active });
  }
  return groups;
}

function buildSectorGroups({ stocks }: GroupSource): Map<string, Group> {
  const groups = new Map<string, Group>();
  for (const [ticker, { sector }] of stocks) {
    // 산업 분류가 없는 종목은 "미분류"로 묶지 않고 뺀다 — 잡동사니 행 하나가 생길 뿐,
    // 그 행의 중앙값은 어떤 산업도 대표하지 않는다.
    if (!sector) continue;
    const found = groups.get(sector);
    if (found) found.tickers.push(ticker);
    else groups.set(sector, { key: sector, name: sector, tickers: [ticker] });
  }
  return groups;
}
