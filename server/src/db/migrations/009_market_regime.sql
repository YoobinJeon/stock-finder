-- 시장 색깔(레짐) 일별 스냅샷 — 지수 등락·breadth(상승/하락 종목수)·투자자별 순매수.
-- 수집 파이프라인의 `computeMarketRegime()`이 채우고 대시보드 "시장 색깔" 카드가 읽는다.
CREATE TABLE IF NOT EXISTS market_regime (
  date            DATE PRIMARY KEY,
  kospi_close     DECIMAL(12,2),
  kospi_chg       DECIMAL(6,2),   -- %
  kospi_up        INT,            -- 상승 종목수
  kospi_down      INT,            -- 하락 종목수
  kosdaq_chg      DECIMAL(6,2),   -- %
  ks_foreign_bn   BIGINT,         -- KOSPI 외국인 순매수 (억원)
  ks_inst_bn      BIGINT,
  kq_foreign_bn   BIGINT,
  rotation_signal TEXT,           -- 순환매 판정 (🟦🟨🟥)
  note            TEXT
);
