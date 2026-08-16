import { AxiosError } from 'axios';

/**
 * API 오류 → 사용자에게 보여줄 한국어 메시지.
 *
 * 서버는 실패 시 `{ error: "..." }`(한국어)를 내려주므로 그 문장을 그대로 쓰는 것이 가장 정확하다.
 * 본문이 없거나 형식이 다를 때만 상태코드별 문구로 폴백한다.
 */
export function apiErrorMessage(err: unknown): string {
  const axiosErr = err as AxiosError<{ error?: string }> | undefined;
  const serverMessage = axiosErr?.response?.data?.error;
  if (typeof serverMessage === 'string' && serverMessage.trim()) return serverMessage;

  const status = axiosErr?.response?.status;
  if (status === 401) return '접속 비밀번호가 필요합니다. 새로고침 후 다시 입력하세요.';
  if (status === 409) return '이미 실행 중인 작업이 있습니다. 끝난 뒤 다시 시도하세요.';
  if (status === 429) return '요청이 너무 많습니다. 잠시 후 다시 시도하세요.';
  if (status === 404) return '대상을 찾을 수 없습니다.';
  if (status != null && status >= 500) return '서버 오류가 발생했습니다. 잠시 후 다시 시도하세요.';

  // 상태코드가 없으면 네트워크 단절·타임아웃 — 서버가 꺼져 있거나 네트워크가 끊긴 경우가 대부분.
  if (axiosErr?.request) return '서버에 연결할 수 없습니다. 네트워크와 서버 상태를 확인하세요.';

  return err instanceof Error && err.message ? err.message : '알 수 없는 오류가 발생했습니다.';
}
