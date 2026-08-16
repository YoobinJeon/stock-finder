/**
 * CSV 파일 내려받기 (브라우저 전용).
 *
 * 순수 포맷 함수(`csv.ts`)와 갈라 둔 이유: 그쪽은 서버 테스트 러너가 import해 검증하는데
 * 서버 tsconfig에는 DOM lib이 없어 `document`·`Blob`이 타입 오류가 된다.
 */

/** 맨 앞의 BOM(\uFEFF)이 없으면 엑셀이 한글을 깨뜨린다. */
export function downloadCsv(filename: string, lines: readonly string[]): void {
  const blob = new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
