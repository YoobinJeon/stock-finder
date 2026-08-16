# 아키텍처

Stock Finder의 구조·데이터 흐름·설계 결정을 정리한 문서입니다.
실행 방법과 기능 소개는 [README.md](README.md) 를 참고하세요.

## 목차

1. [설계 원칙](#1-설계-원칙)
2. [프로젝트 구조](#2-프로젝트-구조)
3. [데이터 파이프라인](#3-데이터-파이프라인)
4. [DB 스키마](#4-db-스키마)
5. [점수 엔진](#5-점수-엔진)
6. [시그널 엔진](#6-시그널-엔진)
7. [스크리너와 전략](#7-스크리너와-전략)
8. [백테스트](#8-백테스트)
9. [API](#9-api)
10. [프론트엔드](#10-프론트엔드)
11. [운영·보안](#11-운영보안)
12. [알려진 한계](#12-알려진-한계)

---

## 1. 설계 원칙

**Local-first.** 인프라 의존성을 0으로 두는 것이 최우선입니다. Docker·Redis·외부 Postgres·인증
서버 없이 `npm run dev` 하나로 전체가 뜹니다. DB는 PGlite(파일 기반 임베디드 Postgres)를 쓰고,
필요하면 `DATABASE_URL` 로 관리형 Postgres에 붙일 수 있습니다.

**Fail-soft.** 외부 소스 스크레이핑이 핵심이라 개별 소스 실패가 전체 수집을 막지 않도록
설계했습니다. 소스가 죽으면 그 항목만 건너뛰고 로그를 남깁니다. 다만 **조용한 성공 보고는
피합니다** — 실패 건수와 실패 목록을 `ingest_runs` 에 남기고 `/data` 화면에 노출합니다.

**순수 함수 분리.** 판정·계산 로직은 DB I/O가 없는 순수 함수로 떼어내고 `node:test` 로 단위
검증합니다. 각 엔진의 `calculate()` 는 조회와 예외 처리만 담당하고, 점수 산출은
`scoreValue`·`scoreGrowth` 같은 순수 함수가 맡습니다.

**런타임 조정.** 점수 가중치는 코드가 아니라 `algorithm_configs` 테이블에 있습니다. 재배포 없이
UI에서 바꾸고 재채점(`scope=rescore`)만 돌리면 반영됩니다.

**단일 프로세스.** PGlite는 한 프로세스만 DB 파일을 열 수 있습니다. 서버가 떠 있는 동안
`migrate`/`pipeline` 스크립트를 따로 돌리면 잠깁니다 — DB 작업은 실행 중인 서버의 API로 합니다.

---

## 2. 프로젝트 구조

```
stock-finder/
├── client/src/
│   ├── pages/              # 화면 단위 (Dashboard, Screener, Sectors, ...)
│   │   ├── screener/       # 화면 내부 조각 (필터·포맷·배지)
│   │   ├── outlook/        # 산업 실적 전망 표·CSV
│   │   ├── monthly/        # 월간 상승률 매트릭스·랭킹
│   │   ├── calendar/       # 실적 캘린더 상세·팝업
│   │   └── compare/        # 종목 비교 표·미니차트
│   └── shared/
│       ├── api/            # client.ts(axios), endpoints.ts(경로 상수)
│       ├── components/     # Layout, CandleChart, StockDetailPanel, ...
│       └── lib/            # 정렬·포맷·CSV·등급 등 순수 유틸
│
├── server/src/
│   ├── api/routes/         # Express 라우터 (도메인별)
│   │   └── market/         # market.routes.ts 분할본 + shared 헬퍼
│   ├── config/
│   │   ├── app.ts          # Express 조립 (helmet·CORS·Basic Auth·정적 서빙)
│   │   ├── database.ts     # PGlite / DATABASE_URL 분기
│   │   └── rateLimit.ts    # 전역·강화·인증 리미터
│   ├── db/
│   │   ├── migrate.ts      # 미적용 마이그레이션만 순서대로 실행 (부팅 시 자동)
│   │   └── migrations/     # 001~045 SQL
│   ├── pipeline/
│   │   ├── ingest.ts       # 수집 오케스트레이션 (스코프 분기)
│   │   ├── scheduler.ts    # node-cron 등록
│   │   ├── catchup.ts      # 부팅 시 누락 슬롯 소급
│   │   ├── JobRunner.ts    # 단일 잡 실행 + 진행률
│   │   └── sources/        # naver*·yahoo*·dart*·kis*·krx* 원천 어댑터
│   ├── scoring/
│   │   ├── CompositeScorer.ts   # 가중 합산 + 보정·제외 규칙
│   │   ├── AlgorithmRegistry.ts # 엔진 등록·설정 오버라이드
│   │   └── engines/             # Value·Quality·Growth·Momentum·TechInnovation·Flow
│   └── backtest/           # runBacktest(PIT), strategyEval, weightEval
│
└── server/scripts/         # CLI 진입점 (migrate, pipeline)
```

**파일 크기 규칙**: 한 파일 800줄을 넘기지 않습니다. `market.routes.ts`(949줄)는 `market/`
하위 서브 라우터로, `ScreenerPage.tsx`는 `screener/` 조각으로 분할한 이력이 있습니다.

---

## 3. 데이터 파이프라인

### 3.1 수집원

| 소스 | 데이터 | 모듈 |
|---|---|---|
| 네이버 금융 모바일 API | 종목 목록·시총, 연간 재무(확정+추정), PER/PBR/배당 | `naverStockList`, `naverFinancials`, `naverConsensus` |
| 네이버 금융 (`finance/quarter`) | 분기 재무 이력 — 확정 5분기 + 컨센서스 1분기 (YoY 기준점 보강용 보조 소스) | `naverQuarterlyFinance` |
| 네이버 금융 (EUC-KR 스크레이핑) | 업종 분류·실시간 등락률, 투자자별 매매동향, 실시간 지수, 신규상장, 오늘 봉 OHLCV | `naverSectors`, `naverInvestorFlows`, `naverIndex`, `naverNewListings` |
| 네이버 테마·ETF | 테마 266개 등락률, ETF 전종목 시세·NAV·편입종목 | `naverThemes`, `naverEtf`, `naverEtfDetail` |
| Yahoo Finance | 해외 지수·심볼 차트, 국내 일봉 폴백 | `yahooPrices`, `yahooSymbolChart` |
| DART OpenAPI | 공시 목록(이벤트 룰용), 분기 실적 이력 백필 | `dartDisclosures`, `dartQuarterly`, `dartCorpCode` |
| KRX 정보데이터시스템 | 투자자별 순매수대금 — 세부 8주체 공식 금액 | `krxInvestorFlows` |
| 한국투자증권 OpenAPI | 국내 일봉(수정주가 정본)·신용잔고·야간선물 | `kisDailyPrice`, `kisCredit`, `kisNightFutures` |

**분기 재무 3원 구조.** 주 소스(네이버 와이즈리포트)는 확정 4분기만 창으로 주기 때문에 YoY
기준점인 Q(t-4)가 빠집니다. 이를 (a) 모바일 `finance/quarter`(확정 5분기)와 (b) DART 다중회사
API 백필(3년치)로 메웁니다. 보조 소스는 **주 소스 창보다 과거인 확정 분기만** 삽입해 선단을
건드리지 않습니다 — 그러지 않으면 어닝 서프라이즈의 E→A 전환 감지가 그 분기를 영구히 놓칩니다.

DART 다중회사 API(`fnlttMultiAcnt`)는 한 호출에 종목 100개를 받고, 4분기는 단독 보고서가 없어
`연간 − (Q1+Q2+Q3)` 로 유도합니다. 금융지주·보험은 주요계정에 매출액이 없어 매출이 결측됩니다.

### 3.2 수집 스코프

`POST /api/v1/data/refresh` 의 body `{scope}` 로 지정합니다.

| scope | 내용 | 소요 |
|---|---|---|
| `top200` | 시총 상위 200 시세·수급·재채점 | ~3분 |
| `kospi` / `all` | KOSPI / 전 종목(~2,800) 전체 수집 | 30분~1시간+ |
| `financials` | 재무·컨센서스만 재수집 후 재채점 | 5~7분 |
| `prices` | 시세만 재수집 후 지표·점수 재계산 (재무·수급·공시 건너뜀) | 중간 |
| `disclosures` | DART 공시만 수집 후 재채점 | 2~3분 |
| `rescore` | **수집 없이** 저장된 데이터로 점수·지표·시그널만 재계산 | 1~2분 |
| `earnings-trend` | **수집 없이** 저장된 분기 재무로 실적 개선만 재판정 | ~3초 |
| `quarterly-backfill` | DART로 분기 실적 이력 백필 후 재판정 (시세·점수 불변) | 10~20분 |
| `schedule-reparse` | 이미 적재된 IR·실적 예정일을 원문에서 재파싱(최근 90일) | ~5분 |

**수집 없는 스코프가 따로 있는 이유**: 판정 규칙을 고칠 때마다 전 종목 재수집(30분+)을 돌리면
반복 주기가 무너집니다. `rescore`·`earnings-trend`·`schedule-reparse` 는 저장된 원본에 새 규칙만
소급 적용하는 경로입니다. `sync` 계열이 `ON CONFLICT DO NOTHING` 이라 기존 행을 못 고치기
때문에 `schedule-reparse` 가 별도로 필요합니다.

`JobRunner` 가 동시 실행을 막습니다(실행 중이면 409). 진행률은 `GET /data/status` 폴링.

### 3.3 스케줄

전부 `server/.env` 의 크론 표현식으로 켜고 끕니다 (미설정이면 비활성).

| 환경변수 | 기본 예시 | 목적 |
|---|---|---|
| `CRON_REFRESH` | `10 18 * * 1-5` | 전체 수집. 18:10인 이유는 네이버 투자자별 수급이 저녁에야 확정되기 때문 |
| `CRON_REFRESH_EARLY` | `50 15 * * 1-5` | 마감 직후 시세·지표·점수만 선반영 (수급은 미확정이라 제외) |
| `CRON_REFRESH_CATCHUP` | `5 19-23 * * 1-5` | 누락 슬롯 소급 — node-cron은 인프로세스 타이머라 프로세스가 꺼져 있으면 그 슬롯을 건너뛴다 |
| `CRON_FLOWS` | `50 15 * * 1-5` | 마감 직후 KRX 수급만 수집 (미발표 시 30분 간격 6회 재시도) |
| `CRON_DISCLOSURES` | 20분마다 | DART 공시 폴링 → 새 공시 종목만 재채점 |
| `CRON_REGIME` | `40 8 * * 1-5` | 시장 색깔만 재계산 |
| `CRON_ETF_SNAPSHOT` / `CRON_THEME_SNAPSHOT` | `50 15 * * 1-5` | ETF·테마 일별 스냅샷 적재 |

부팅 시 `catchup.ts` 가 한 번 점검해 그날 놓친 수집을 채웁니다 (fail-soft, 부팅 비차단).

### 3.4 수정주가 자동 복구

증분 수집은 액면분할·감자를 소급 반영하지 않아 과거 행이 옛 가격 스케일로 남습니다.
`priceRepair.ts` 가 이를 고칩니다.

1. **후보 감지** — KRX 가격제한폭 ±30% 근거로, 연속 거래일 종가 비율이 `[0.6, 1.4]` 밖인 티커.
2. **사실 확인** — 후보별로 KIS의 수정주가·원주가 두 계열을 받아 종가 비율이 바뀌는 지점을
   찾습니다. 비율이 1.0에서 벗어난 구간이 소급 조정 구간이고, 그 비율이 조정 배수입니다.
3. **교체** — 해당 티커의 시세를 DELETE 후 청크 INSERT.

휴리스틱으로 "분할인 것 같다"고 추측하지 않고 **원천이 주는 두 계열의 차이로 사실을 확인**하는
것이 핵심입니다. KIS 스펙의 `flng_cls_code`·`prtt_rate` 는 실측 결과 기업행위가 있어도 비어
있어(액면분할 3건 전부 `00`·`0.00`) 쓸 수 없었습니다.

> **PGlite 특이점**: 미참조 data-modifying CTE의 부수효과가 실행되지 않습니다
> (`WITH del AS (DELETE…) INSERT` 패턴에서 DELETE가 무시됨). 순차 2문으로 씁니다.

### 3.5 상장폐지 감지

종목 upsert가 `is_active=TRUE` 만 세팅하면 상폐 종목이 `WHERE is_active=TRUE` 유니버스에 영구
잔류합니다. `delisting.ts` 가 `scope=all` 수집에서만, upsert 직전 활성 목록과 이번 fetch 목록을
비교해 빠진 종목을 비활성화합니다.

안전 가드 3중:
- `scope=all` 에서만 실행 — `top200`/`kospi` 는 부분 목록이라 "없음"이 상폐를 뜻하지 않음
- fetch 수가 활성 수의 97% 미만이면 소스 이상으로 보고 스킵 + 경고
- 1회 비활성화 상한 30건 초과 시 스킵 + 경고 (정상 상폐는 하루 몇 건)

---

## 4. DB 스키마

부팅 시 `runMigrations()` 가 `schema_migrations` 에 없는 파일만 파일명 순으로 실행합니다(멱등).

### 핵심 테이블

| 테이블 | 용도 |
|---|---|
| `stocks` | 종목 마스터 (티커·이름·시장·섹터·시총·`is_active`·`corp_code`·상장일·사업개요) |
| `stock_prices` | 일봉 OHLCV (ticker + trade_date PK) |
| `stock_financials` | 연간·분기 재무. `fiscal_quarter IS NULL` = 연간, `is_estimate` 로 확정/추정 구분 |
| `stock_scores` | 종목별 최신 총점 + `breakdown` JSONB (엔진별 점수·사유) |
| `stock_indicators` | 종목당 1행 기술·수급 지표 집계 (이평선·RSI·MACD·볼린저·ATR·OBV·RS 백분위·순매수 5/20일) |
| `stock_flows` / `stock_flows_krx` | 투자자별 수급 — 네이버 근사치 / KRX 세부 8주체 공식 금액 |
| `algorithm_configs` | 점수 엔진의 enabled·weight·params 오버라이드 |
| `screener_presets` | 스크리너 전략 프리셋 (기본 6종 + 거장 전략 3종 + 엘리엇 근사 시드) |
| `signals` | 시그널 발생 기록 (date + ticker + type 유니크) |
| `score_history` | 일별 점수 스냅샷 — 백테스트 원료 |
| `disclosure_events` | DART 공시 + 이벤트 분류 + 조달금액 (rcept_no PK) |
| `earnings_surprises` | 분기 E→A 전환 시 직전 컨센서스 대비 확정치 (분기당 1행) |
| `stock_earnings_trend` | 분기 실적 개선 판정 결과 (ticker PK) — YoY/QoQ 증가율·연속 개선 분기 수·차기 컨센서스 |
| `earnings_schedules` | IR·실적 발표 예정일 (원문 파싱, 시각 포함) |
| `market_regime` | 일별 시장 색깔 — 지수·breadth·투자자별 순매수·순환매 판정 |
| `themes` / `theme_snapshots` | 네이버 테마 + 일별 등락률 스냅샷 (로테이션 계산용) |
| `etf_snapshots` / `etf_phase_history` | ETF 일별 시세·NAV + 국면(state) 이력 |
| `watchlist` | 관심종목 (ticker PK, memo) |
| `backtest_runs` | 백테스트 실행 결과 (kind/params/result JSONB) |
| `ingest_runs` | 수집 이력 (스코프·상태·총량·실패 목록·비활성화 건수) |

**`stock_earnings_trend` 가 `stock_indicators` 와 분리된 이유**: 갱신 주기가 다릅니다. 지표는
일 단위(시세)지만 실적 개선 판정은 분기 발표 시점에만 바뀝니다. 또한 스크리너의 WHERE 조건이
전 종목에 걸리므로 조회마다 재계산하지 않고 적재해 둡니다.

---

## 5. 점수 엔진

### 5.1 팩터 구성

각 엔진은 `AlgorithmEngine` 을 상속하고, `CompositeScorer` 가 활성 엔진의 가중 합산으로 총점을
냅니다. 가중치 합이 1이 아니어도 **활성 엔진끼리 자동 정규화**됩니다.

| 엔진 | 기본 가중치 | 계산 |
|---|---|---|
| `value_v1` | 0.30 | PER·PBR·배당수익률 저평가, 일회성 이익 왜곡 감지 |
| `quality_v1` | 0.25 | ROE·영업이익률·부채비율·이익의 질(3개년 시계열) |
| `growth_v1` | 0.20 | 매출·EPS YoY, 일회성 급증·기저효과 반등 감지 |
| `momentum_v1` | 0.15 | 1·3개월 수익률(±10) + RS 백분위(≥90 +15 / ≥80 +10 / ≥70 +5 / ≤30 −8) + RSI(40~65 +8 / >70 −10 / <30 −8) + 거래대금급증 브레이크아웃(+5) |
| `tech_innovation_v1` | 0.10 | 섹터 기술성 기본점수 + 종목명·업종 키워드 |
| `flow_v1` | **0.00** | 쌍끌이 +12 / 편측 +6, 연속 순매수 ≥5일 +8·+5, OBV 상승 +4, 동반 이탈 −8 |

**모멘텀의 6·12개월 절대수익률을 뺀 이유**: 크로스섹션 RS 백분위가 같은 역할을 하므로 남기면
이중계상입니다. RS가 없는 종목(신규 상장 등)만 4구간 사다리로 폴백합니다.

**`flow_v1` 이 가중치 0인 이유**: 백테스트로 유효성이 확인되기 전까지 총점에 영향을 주지 않되
`breakdown`·`score_history` 에는 기록을 쌓아 검증 표본을 모으려는 설계입니다. `CompositeScorer`
는 가중치와 무관하게 전 활성 엔진을 계산하지만 `weight/totalWeight = 0` 이라 기여는 0입니다.
커버리지 분모·결측 카운트에서도 제외합니다 — 그러지 않으면 flow 데이터가 없는 종목마다
"n/5"가 흔들리고, 무해한 종목에 커버리지 수축이 잘못 걸립니다.

### 5.2 보정·제외 규칙

`CompositeScorer` 가 가중 합산 뒤에 순서대로 적용합니다.

1. **규모 신뢰도 보정** — 초소형주는 재무 노이즈가 크므로 50점 초과분을 수축
   (시총 500억↓ ×0.7 / 1,000억↓ ×0.8 / 3,000억↓ ×0.85 / 1조↓ ×0.95)
2. **데이터 커버리지 수축** — `dataMissing` 엔진이 2개 이상이면 50점 초과분 ×0.85.
   결측을 중립 50으로 fail-soft 처리하다 보니 재무 부실 종목이 중간 점수로 부풀던 편향 완화.
3. **위험종목 제외** — 최신 확정연도 부채비율 500% 초과 **또는** 3년 연속 영업손실 → 총점 30점 캡
4. **공시 이벤트 룰** (DART 제목 키워드 기반)
   - 🚫 제외 (90일 내, 30점 캡): 횡령·배임 / 관리종목 / 상장폐지 / 감사의견 거절
   - ⚠️ 감점 (30일 내): 유상증자 −5, 감자 −8, CB 발행 −3.
     유상증자·CB는 **조달금액/시총 비율로 차등** — `<3%` −2 / `3~10%` 기본값 / `>10%` −10·−6
   - ✅ 가점 (30일 내): 자사주 매입 +10(신탁 +5), 판매·공급계약 +5
   - **동일 유형 가점은 30일 창에서 1회만** — 공급계약을 반복 공시하는 종목이 캡까지 부풀리는
     왜곡 방지. 감점은 건별 위험이 누적되므로 중복 허용
   - 델타 합산 ±15 캡. `[기재정정]` 은 중복 방지를 위해 정보성 처리
5. **이익의 질** (`earningsQuality`) — 순이익이 영업이익보다 비정상적으로 큰 "일회성"만 감점하고,
   매년 그런 지주사·지분법 구조는 면제 (3개년 시계열로 판단)

### 5.3 런타임 조정

`algorithm_configs` 가 코드 기본값을 오버라이드합니다. 전략 관리 화면의 "점수 알고리즘 가중치"
카드에서 활성화 토글·가중치를 바꾸고 저장한 뒤, **재채점(`scope=rescore`)을 돌려야**
`stock_scores` 에 반영됩니다.

---

## 6. 시그널 엔진

수집 시 종목별로 감지해 `signals` 테이블에 기준일당 1회 기록합니다. 판정은 전부 순수 함수
(`signalDetection.ts`)이며 단위 테스트가 있습니다.

| 시그널 | 조건 |
|---|---|
| `volume_surge_high` | 거래대금급증 ≥3배 **&&** 종가가 52주 고점 대비 −3% 이내 |
| `inst_new_accum` | 기관 5일 순매수 > 0 **&&** 기관 20일 순매수 ≤ 0 (신규 매집 전환) |
| `rs_top_entry` | 오늘 RS 백분위 ≥90 **&&** 직전 <90 (상위 10% 신규 진입) |
| `early_trend` | MA5/MA10 기반 추세 초기 전환 |

**적중률 추적**은 시그널 발생일 종가 대비 **고정 보유기간(5거래일)** 수익률로 계산합니다.
마크투마켓 스냅샷(시그널일 → 현재 최신봉) 방식은 보유기간이 시그널마다 제각각이라 하락장에서
수치가 왜곡되어 폐기했습니다.

---

## 7. 스크리너와 전략

### 필터 축

재무(PER·PBR·ROE·부채비율·배당·EV/EBITDA), 성장(매출·EPS YoY, 분기 실적 개선 YoY/QoQ),
수급(외인·기관 순매수 5/20일), 기술(RS 백분위·이평선 정배열·52주 고점 대비·RSI·거래대금급증),
규모(시총 구간), 점수(총점·엔진별 서브점수).

### 프리셋

`screener_presets` 에 기본 6종과 함께 공개된 거장 전략의 **근사 매핑** 3종이 시드되어 있습니다.

| 프리셋 | 근사 방식 |
|---|---|
| 미너비니 SEPA | MA50 > MA150 > MA200 · MA200 상승 · 52주 저점 대비 +30% 이상 · RS 백분위 70+ |
| 오닐 CANSLIM | 분기 EPS 성장 · RS 백분위 80+ · 52주 고점 근접 · 거래대금 급증 |
| 드러켄밀러 | 대형주 · 모멘텀 상위 · 수급 유입 |
| 엘리엇 파동 | 일봉 지표로는 파동 자체를 검증할 수 없어 추세·되돌림 조건으로 대체한 **근사** |

> ⚠️ 이들은 원 전략의 **근사**입니다. 일봉 수준 공개 데이터로 표현 가능한 조건만 옮겼으므로
> 원 저자의 실제 규칙과 동일하지 않습니다.

### 실적 개선 필터 (분기 YoY·QoQ)

매출은 YoY를 직접 계산하고, 이익은 t−4 분기를 조회해 비교합니다. 확정 분기 최대 4개 제약 때문에
YoY 기준점이 없는 종목이 생기며, 그래서 §3.1의 보조 소스 백필이 필요합니다. 판정 결과는
`stock_earnings_trend` 에 적재하고, 증가율만으로는 규모를 알 수 없어 **기준·비교 분기의 원값**도
함께 담습니다.

---

## 8. 백테스트

`score_history` 에 쌓인 일별 점수 스냅샷을 기준일 시점 그대로 읽는 **Point-in-Time** 방식입니다.
미래 정보가 새지 않도록 기준일 이후 데이터는 조회하지 않습니다.

- **생존편향 완화**: 유니버스에서 `is_active=FALSE` 종목을 배제하지 않고 포함해 계산하고,
  그 개수(`delistedCount`)를 결과에 노출합니다 — 편향을 없애기보다 **크기를 계량**하는 접근입니다.
- **가중치 세트 평가기**(`POST /backtest/weights`): PIT 데이터셋의 팩터별 개별 점수를 원료로
  여러 가중치 조합을 한 번에 평가합니다. `flow_v1` 같은 검증 중인 팩터의 채택 근거로 씁니다.
- 실행 결과는 `backtest_runs` 에 저장합니다. 저장 실패가 API 응답을 막지 않도록 fail-soft 처리.

> ⚠️ 거래비용·세금·슬리피지가 반영되어 있지 않습니다. 결과는 상대 비교용입니다.

---

## 9. API

전부 `/api/v1` 하위입니다. 클라이언트의 경로 상수는 `client/src/shared/api/endpoints.ts` 에
모여 있습니다.

| 그룹 | 주요 엔드포인트 |
|---|---|
| `/stocks` | 목록 · 상세 · 시세 · 공시 · 뉴스 · 신용잔고 · 밸류에이션 밴드 · 비교(2~4종) |
| `/screener` | 조건 검색 · 프리셋 CRUD |
| `/scoring` | 종목별 점수 분해 |
| `/market` | 지수 · 매크로 · 시장 색깔 · 수급 순위 · 섹터 · 특징주 · RS 랭킹 · 글로벌 피어 · 어닝 서프라이즈 · 산업 실적 전망 · 월간 상승률 |
| `/market/turnover` | 시장/산업/관심종목 주간 거래대금 |
| `/signals` | 시그널 피드 · 적중률 · 이벤트 공시 |
| `/calendar` | 실적 캘린더 이벤트 |
| `/etf` | 목록 · 차트보드 · 자금유입 · 스냅샷 적재 |
| `/themes` | 목록 · 상세 · 로테이션 · 스냅샷 |
| `/watchlist` | 관심종목 CRUD |
| `/algorithms` | 점수 엔진 설정 조회·수정 |
| `/backtest` | 실행 · 가중치 평가 · 이력 |
| `/data` | 수집 실행 · 진행률 · 보유 현황 · 공시/수급 폴링 · 가격 재정합 |

응답 캐시는 라우트별 TTL 캐시(`utils/ttlCache.ts`)를 씁니다. `GET /market/rs` 는 전 종목 윈도우
함수 피벗이라 무겁기 때문에 10분 캐시 + single-flight 로 스탬피드를 막습니다.

---

## 10. 프론트엔드

- **라우팅**: 대시보드만 정적 import, 나머지 화면은 `lazy()` 로 분할해 초기 번들에서 덜어냅니다.
- **데이터 페칭**: TanStack Query. 장중(`isKstMarketOpen()`)에만 폴링을 켜는 패턴을 씁니다
  (시세 30초, 시장 색깔 90초, 글로벌 피어 180초).
- **에러 처리**: `MutationCache.onError` 에서 쓰기 실패를 한 번에 토스트로 띄웁니다 — 화면마다
  개별 `onError` 를 다는 방식은 새 화면이 생길 때마다 빠뜨리기 쉬웠습니다.
- **테마**: Tailwind 팔레트를 `index.css` 의 `--sf-*` CSS 변수로 재정의하고 다크 테마에서 값을
  뒤집습니다. 재정의 목록에 없는 명암(`-800`, `indigo` 등)을 쓰면 다크에서 "어두운 배경 + 어두운
  글씨"가 되므로, `themeSafeColors.test.ts` 가 이를 자동 검사합니다.
- **번들**: `vite.config.ts` 의 `manualChunks` 로 vendor를 분리합니다.

> ⚠️ `vite build --watch` 는 시작 시점의 설정을 붙들고 있어 **`vite.config.ts` 변경을 모릅니다.**
> 빌드 설정을 고쳤거나 콘솔에 원인 불명 오류(예: React error #321)가 보이면 watcher부터
> 재시작하고 `npx vite build` 결과와 대조하세요. 개발 모드에서는 재현되지 않습니다.

---

## 11. 운영·보안

| 항목 | 설정 |
|---|---|
| Basic Auth | `ACCESS_PASSWORD` 설정 시 앱 전체에 한 겹. 다이제스트끼리 `timingSafeEqual` 비교로 길이·내용 모두 타이밍 누출 차단. 미설정 시 부팅 경고 |
| 레이트리밋 | 전역 분당 300 + heavy(`POST /data/*`, `GET /market/rs`, `/screener`, `POST /etf/snapshot`) 분당 10 + 인증 실패 리미터 |
| `trust proxy` | `'loopback'` 만 신뢰. 리버스 프록시가 `127.0.0.1` 로 프록시하면 이 설정 없이는 공개 트래픽 전부가 로컬로 보여 리미터가 통째로 무력화됩니다 |
| CSP | `helmet` 으로 `'self'` 기준 활성. 인라인 스크립트는 `public/theme-init.js` 로 분리. `styleSrc` 의 `'unsafe-inline'` 은 React `style={{}}` 때문에 필요 |
| 에러 응답 | 클라이언트에는 일반 문구, 서버 로그에 스택까지 |
| 입력 검증 | 티커는 라우터 `param` 레벨 정규식, 배열 파라미터는 파싱·상한 검증, 모든 쿼리는 파라미터화 |

---

## 12. 알려진 한계

- **스크레이핑 의존**: 소스 측 HTML·API 변경 시 파서가 깨집니다. 동작을 보장하지 않습니다.
- **수정주가 복구 미달**: 감자 후 거래정지 종목은 원천에도 불연속이 있어 복구되지 않습니다
  (RS 계산의 불연속 가드가 안전망). 소액 배수 기업행위(1.2:1 병합 등)는 ±30% 후보 감지에
  걸리지 않습니다.
- **금융업 매출 결측**: DART 주요계정에 매출액이 없어 금융지주·보험은 매출이 비어 있습니다.
- **수급 이력 시작점**: 누적 평단은 데이터 축적 시작 이후만 반영하므로 그 이전 매집은 빠집니다.
- **분기 재무 창 제약**: 주 소스가 확정 4분기만 주므로 백필이 없으면 YoY 기준점이 빕니다.
- **RS 모집단 차이**: `/rs` 화면은 거래정지·가격 불연속 종목을 랭킹에서 배제하지만, 배치가
  저장하는 `rs_percentile` 은 스크리너 커버리지 유지를 위해 그 가드를 적용하지 않습니다 —
  소수 종목에서 두 화면 수치가 갈릴 수 있습니다.
- **거장 전략은 근사**: §7 참고.
- **백테스트에 비용 미반영**: §8 참고.
