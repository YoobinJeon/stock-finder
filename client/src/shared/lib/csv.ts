/**
 * CSV 문자열 만들기 — 스크리너와 산업 실적 전망이 함께 쓴다.
 *
 * 두 화면이 같은 이스케이프 코드를 각자 갖고 있었다. 세 번째 화면이 생기기 전에 모은다.
 *
 * ⚠️ **여기에는 DOM을 쓰지 않는다.** 브라우저 다운로드는 `downloadCsv.ts`로 갈라 뒀다 —
 * 서버 테스트 러너가 이 파일을 그대로 import해 검증하는데 서버 tsconfig에는 DOM lib이 없다.
 */

/**
 * CSV 한 칸 이스케이프.
 *
 * 큰따옴표로 감싸 쉼표·줄바꿈이 칸을 깨뜨리지 않게 하고, 내부 따옴표는 두 번 적는다.
 *
 * ⚠️ **수식 주입 방어**: 엑셀은 `=`, `+`, `-`, `@`로 시작하는 칸을 수식으로 실행한다.
 * 따옴표로 감싸도 막히지 않으므로 문자열 값이 그 문자로 시작하면 앞에 작은따옴표를 붙인다.
 * **숫자는 건드리지 않는다** — 음수(-12.3)까지 텍스트로 바꾸면 스프레드시트에서 계산이 안 된다.
 */
export function csvCell(v: unknown): string {
  if (v == null) return '""';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '""';

  const s = String(v);
  const guarded = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${guarded.replace(/"/g, '""')}"`;
}

/** 행 배열 → CSV 한 줄씩. */
export function csvLine(cells: readonly unknown[]): string {
  return cells.map(csvCell).join(',');
}

/** 파일명에 쓸 오늘 날짜 (YYYY-MM-DD). */
export function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}
