/**
 * UUID 형식 검사 — id가 UUID 컬럼인 라우트(`screener_presets` 등)에서
 * 잘못된 형식을 Postgres까지 흘려보내지 않기 위한 것.
 *
 * 검증이 없으면 `WHERE id = $1`에 'abc'가 들어가 PG가 22P02(invalid_text_representation)를
 * 던지고, 사용자 입력 오류가 500 Internal Server Error로 보고된다.
 * 버전·variant 비트까지 따지지 않는 이유: DB가 받아들이는 형식인지만 알면 충분하기 때문.
 */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 문자열이 UUID 형식인지 */
export function isUuid(v: unknown): boolean {
  return typeof v === 'string' && UUID_RE.test(v);
}
