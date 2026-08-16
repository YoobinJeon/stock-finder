-- 앱 설정 키-값 저장소 (런타임 발견 값 보관용 범용 KV)
CREATE TABLE IF NOT EXISTS app_settings (
  key        VARCHAR(50) PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
