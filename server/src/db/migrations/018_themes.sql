-- 네이버 테마 스냅샷 (테마 목록·구성종목만 저장 — 등락률 등 시세는 라이브 스크레이프)
CREATE TABLE IF NOT EXISTS themes (
  theme_no   INT PRIMARY KEY,          -- 네이버 테마 번호 (sise_group_detail no=)
  name       TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS theme_members (
  theme_no INT NOT NULL REFERENCES themes(theme_no) ON DELETE CASCADE,
  ticker   VARCHAR(10) NOT NULL,
  PRIMARY KEY (theme_no, ticker)
);

CREATE INDEX IF NOT EXISTS idx_theme_members_ticker ON theme_members(ticker);
