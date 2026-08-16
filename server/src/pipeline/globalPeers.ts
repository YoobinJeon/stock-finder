/**
 * 글로벌 피어 보드 큐레이션 — 해외 기업 ↔ 국내 피어 그룹.
 * etfCuration.ts 패턴을 따라 상수·순수함수를 별도 모듈로 분리 (market.routes.ts에서 재사용).
 * 심볼은 fetchQuote(Yahoo)로 실측 확인 후 확정 — 데이터가 안 오는 심볼은 그룹에서 제외한다.
 * (2026-07-12 최초 실측: 기존 5그룹 전 심볼 정상 응답 확인, 제외분 없음)
 * (2026-07-12 확장 실측: 신규 10그룹 30개 해외 심볼 단독 fetchQuote 전량 정상 응답, 제외분 없음 —
 *  섹터 단위로 그룹을 넓혔다)
 * (2026-07-12 2차 확장 실측: 신규 28개 해외 심볼 단독 fetch 전량 정상 응답, 제외분 없음 —
 *  전력반도체·로봇·AI반도체 그룹을 추가하고
 *  그룹당 해외 3개 제한을 해제했다(4~6개))
 * (2026-07-18 실측: SKHY(SK하이닉스 ADR, 나스닥GS) 단독 fetch 정상 응답 확인 후 메모리 반도체
 *  그룹에 추가)
 * (2026-07-18 실측: 4062.T(이비덴, 도쿄) 단독 fetch 정상 응답 확인 후 기판·MLCC 그룹에 추가)
 */

export interface GlobalPeerForeign {
  symbol: string; // Yahoo Finance 심볼 (URL 인코딩 불필요 — '.'만 포함)
  name: string;
}

export interface GlobalPeerGroup {
  name: string;
  foreign: GlobalPeerForeign[];
  domestic: string[]; // 국내 티커 (6자리)
}

export const GLOBAL_PEER_GROUPS: GlobalPeerGroup[] = [
  {
    name: '기판·MLCC',
    foreign: [
      { symbol: '6981.T', name: '무라타' },
      { symbol: '6976.T', name: '다이요유덴' },
      { symbol: '6762.T', name: 'TDK' },
      { symbol: '4062.T', name: '이비덴' }, // 패키지 기판 — 2026-07-18 실사용 요청
    ],
    domestic: ['009150'], // 삼성전기
  },
  {
    name: '메모리 반도체',
    foreign: [
      { symbol: 'MU', name: '마이크론' },
      { symbol: 'SKHY', name: 'SK하이닉스 ADR' }, // 나스닥GS 상장분 — 야간 ADR 흐름 추적용
      { symbol: 'SNDK', name: '샌디스크' },
      { symbol: '285A.T', name: '키옥시아' },
      { symbol: 'WDC', name: '웨스턴디지털' },
    ],
    domestic: ['005930', '000660'], // 삼성전자·SK하이닉스
  },
  {
    name: '파운드리',
    foreign: [
      { symbol: '2330.TW', name: 'TSMC' },
      { symbol: 'INTC', name: '인텔' },
      { symbol: 'GFS', name: '글로벌파운드리' },
      { symbol: 'UMC', name: 'UMC' },
    ],
    domestic: ['005930'],
  },
  {
    name: '2차전지',
    foreign: [
      { symbol: '300750.SZ', name: 'CATL' },
      { symbol: '6752.T', name: '파나소닉' },
    ],
    domestic: ['373220', '006400'], // LG에너지솔루션·삼성SDI
  },
  {
    name: '자동차',
    foreign: [
      { symbol: '7203.T', name: '토요타' },
      { symbol: '7267.T', name: '혼다' },
      { symbol: '1211.HK', name: 'BYD' },
    ],
    domestic: ['005380', '000270'], // 현대차·기아
  },
  // ── 섹터 확장 (2026-07-12) ──
  {
    name: '우주·방산',
    foreign: [
      { symbol: 'LMT', name: '록히드마틴' },
      { symbol: 'RTX', name: 'RTX' },
      { symbol: 'RKLB', name: '로켓랩' },
      { symbol: 'BA', name: '보잉' },
      { symbol: 'PLTR', name: '팔란티어' },
    ],
    domestic: ['012450', '079550', '047810'], // 한화에어로스페이스·LIG넥스원·한국항공우주
  },
  {
    name: '화장품',
    foreign: [
      { symbol: 'OR.PA', name: '로레알' },
      { symbol: 'EL', name: '에스티로더' },
      { symbol: '4911.T', name: '시세이도' },
    ],
    domestic: ['090430', '051900'], // 아모레퍼시픽·LG생활건강
  },
  {
    name: '음식료',
    foreign: [
      { symbol: 'NESN.SW', name: '네슬레' },
      { symbol: 'KO', name: '코카콜라' },
      { symbol: '2802.T', name: '아지노모토' },
    ],
    domestic: ['097950', '271560'], // CJ제일제당·오리온
  },
  {
    name: '전력기기',
    foreign: [
      { symbol: 'ETN', name: '이튼' },
      { symbol: 'SU.PA', name: '슈나이더' },
      { symbol: '6501.T', name: '히타치' },
      { symbol: 'GEV', name: 'GE버노바' },
      { symbol: 'ENR.DE', name: '지멘스에너지' },
      { symbol: '6503.T', name: '미쓰비시전기' },
    ],
    domestic: ['267260', '298040', '010120'], // HD현대일렉트릭·효성중공업·LS ELECTRIC
  },
  {
    name: '원자력',
    foreign: [
      { symbol: 'CCJ', name: '카메코' },
      { symbol: 'CEG', name: '컨스텔레이션' },
      { symbol: 'BWXT', name: 'BWXT' },
    ],
    domestic: ['034020'], // 두산에너빌리티
  },
  {
    name: '신재생·대체에너지',
    foreign: [
      { symbol: 'FSLR', name: '퍼스트솔라' },
      { symbol: 'VWS.CO', name: '베스타스' },
      { symbol: 'NEE', name: '넥스트에라' },
      { symbol: 'BE', name: '블룸에너지' },
      { symbol: 'ENPH', name: '인페이즈' },
      { symbol: 'ORSTED.CO', name: '오스테드' },
    ],
    domestic: ['009830', '112610', '336260'], // 한화솔루션·씨에스윈드·두산퓨얼셀
  },
  {
    name: '반도체장비',
    foreign: [
      { symbol: 'ASML', name: 'ASML' },
      { symbol: 'AMAT', name: '어플라이드' },
      { symbol: '8035.T', name: '도쿄일렉트론' },
      { symbol: 'LRCX', name: '램리서치' },
      { symbol: 'KLAC', name: 'KLA' },
    ],
    domestic: ['042700', '036930'], // 한미반도체·주성엔지니어링
  },
  {
    name: '제약·바이오',
    foreign: [
      { symbol: 'LLY', name: '일라이릴리' },
      { symbol: 'NVO', name: '노보노디스크' },
      { symbol: '4502.T', name: '다케다' },
      { symbol: 'AMGN', name: '암젠' },
    ],
    domestic: ['207940', '068270'], // 삼성바이오로직스·셀트리온
  },
  {
    name: '인터넷·플랫폼',
    foreign: [
      { symbol: 'GOOGL', name: '알파벳' },
      { symbol: 'META', name: '메타' },
      { symbol: '0700.HK', name: '텐센트' },
      { symbol: 'AMZN', name: '아마존' },
      { symbol: 'AAPL', name: '애플' },
    ],
    domestic: ['035420', '035720'], // NAVER·카카오
  },
  {
    name: '게임',
    foreign: [
      { symbol: '7974.T', name: '닌텐도' },
      { symbol: 'RBLX', name: '로블록스' },
      { symbol: 'EA', name: 'EA' },
    ],
    domestic: ['259960', '036570'], // 크래프톤·엔씨소프트
  },
  // ── 전력반도체·로봇·AI반도체 (2026-07-12) ──
  {
    name: '전력반도체',
    foreign: [
      { symbol: 'IFX.DE', name: '인피니언' },
      { symbol: 'ON', name: '온세미' },
      { symbol: 'STM', name: 'ST마이크로' },
      { symbol: '6963.T', name: '로옴' },
    ],
    domestic: ['000990'], // DB하이텍
  },
  {
    name: '로봇',
    foreign: [
      { symbol: 'TSLA', name: '테슬라' },
      { symbol: 'NVDA', name: '엔비디아' },
      { symbol: '6954.T', name: '화낙' },
      { symbol: '6506.T', name: '야스카와전기' },
    ],
    domestic: ['277810', '454910'], // 레인보우로보틱스·두산로보틱스
  },
  {
    name: 'AI 반도체',
    foreign: [
      // NVDA는 로봇 그룹과 중복 정의 — 그룹별 관점이 달라 의도된 중복(fetch는 dedup됨)
      { symbol: 'NVDA', name: '엔비디아' },
      { symbol: 'AMD', name: 'AMD' },
      { symbol: 'AVGO', name: '브로드컴' },
      { symbol: 'MRVL', name: '마벨' },
    ],
    domestic: ['000660', '005930'], // SK하이닉스·삼성전자
  },
];

/** 심볼 접미사로 통화 추정 — Yahoo 응답 meta.currency가 없을 때만 폴백으로 사용. */
export function inferCurrency(symbol: string): string {
  if (symbol.endsWith('.T')) return 'JPY';
  if (symbol.endsWith('.TW')) return 'TWD';
  if (symbol.endsWith('.SZ')) return 'CNY';
  if (symbol.endsWith('.PA')) return 'EUR'; // 파리
  if (symbol.endsWith('.SW')) return 'CHF'; // 스위스
  if (symbol.endsWith('.CO')) return 'DKK'; // 코펜하겐
  if (symbol.endsWith('.HK')) return 'HKD'; // 홍콩
  if (symbol.endsWith('.DE')) return 'EUR'; // 프랑크푸르트/Xetra
  return 'USD';
}

/** 전 그룹의 국내 피어 티커를 중복 없이 모은다 (stocks JOIN·시세 일괄조회용). */
export function collectDomesticTickers(groups: GlobalPeerGroup[]): string[] {
  return [...new Set(groups.flatMap((g) => g.domestic))];
}

/**
 * 전 그룹의 해외 심볼을 중복 없이 모은다.
 * NVDA처럼 동일 심볼이 여러 그룹(로봇·AI반도체)에 걸쳐 정의될 때 Yahoo fetch가
 * 중복 호출되지 않도록 market.routes.ts의 fetchAllForeignQuotes에서 사용.
 * 먼저 등장한 그룹의 name(표기)을 채택 — 그룹마다 표기가 동일해 결과에 영향 없음.
 */
export function collectUniqueForeignSymbols(groups: GlobalPeerGroup[]): GlobalPeerForeign[] {
  const seen = new Set<string>();
  const out: GlobalPeerForeign[] = [];
  for (const g of groups) {
    for (const f of g.foreign) {
      if (seen.has(f.symbol)) continue;
      seen.add(f.symbol);
      out.push(f);
    }
  }
  return out;
}
