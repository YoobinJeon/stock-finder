import { useEffect, useState } from 'react';

/**
 * 전역 알림(토스트) — 주로 mutation 실패를 사용자에게 알리는 용도.
 *
 * 이게 필요한 이유: 이 앱의 쓰기 동작(수집 시작·포지션 추가·전략 저장·차트보드 저장 등)은
 * 전부 실패해도 화면이 그대로여서, 사용자가 "눌렀는데 아무 일도 안 일어난" 상태로 남았다.
 * App.tsx의 MutationCache.onError가 여기로 흘려보내 한 곳에서 처리한다.
 *
 * 외부 라이브러리를 쓰지 않은 이유: 필요한 기능이 "메시지를 잠깐 띄우고 사라진다"뿐이고,
 * 개인용 로컬 도구에 새 의존성을 더할 이유가 없다.
 */

const TOAST_TTL_MS = 6000;
const MAX_VISIBLE = 3;

export type ToastKind = 'error' | 'info';

interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

type Listener = (toasts: Toast[]) => void;

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) listener(toasts);
}

function dismiss(id: number): void {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

/** 토스트 표시. 같은 메시지가 이미 떠 있으면 중복 표시하지 않는다(실패 연타 방지). */
export function showToast(message: string, kind: ToastKind = 'error'): void {
  if (toasts.some((t) => t.message === message)) return;

  const id = nextId++;
  toasts = [...toasts, { id, kind, message }].slice(-MAX_VISIBLE);
  emit();
  setTimeout(() => dismiss(id), TOAST_TTL_MS);
}

export function Toaster() {
  const [items, setItems] = useState<Toast[]>(toasts);

  useEffect(() => {
    listeners.add(setItems);
    return () => { listeners.delete(setItems); };
  }, []);

  if (items.length === 0) return null;

  return (
    // aria-live=assertive: 실패는 즉시 읽혀야 하는 정보라 polite로 미루지 않는다.
    <div
      role="status"
      aria-live="assertive"
      className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-[min(24rem,calc(100vw-2rem))]"
    >
      {items.map((t) => (
        <div
          key={t.id}
          className={`flex items-start gap-2 rounded-lg px-4 py-3 text-sm shadow-lg border ${
            t.kind === 'error'
              ? 'bg-red-50 border-red-200 text-red-700'
              : 'bg-blue-50 border-blue-200 text-blue-700'
          }`}
        >
          <span aria-hidden="true">{t.kind === 'error' ? '⚠️' : 'ℹ️'}</span>
          <p className="flex-1 leading-relaxed">{t.message}</p>
          <button
            type="button"
            aria-label="알림 닫기"
            onClick={() => dismiss(t.id)}
            className="shrink-0 text-lg leading-none opacity-60 hover:opacity-100"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
