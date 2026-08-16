import { useEffect } from 'react';
import { CATEGORY_BADGE, CATEGORY_LABEL, sortEarningsEvents } from './earningsTypes';
import type { EarningsEvent } from './earningsTypes';
import { WEEKDAY_LABELS } from './calendarMonth';

interface SelectedStock {
  ticker: string;
  name: string;
  market: string;
  sector: string | null;
}

export type PopupState =
  | { mode: 'event'; event: EarningsEvent }
  | { mode: 'dayList'; date: string; events: EarningsEvent[] };

interface Props {
  state: PopupState;
  onClose: () => void;
  onSelectStock: (stock: SelectedStock) => void;
  onSelectEvent: (event: EarningsEvent) => void;
}

function formatMonthDay(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}-${dd}`;
}

function formatDayLabel(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  return `${formatMonthDay(date)} (${WEEKDAY_LABELS[d.getDay()]})`;
}

/** 캘린더 칩/+N 클릭으로 뜨는 중앙 팝업 — 이벤트 상세(event) / 날짜 전체 목록(dayList) 두 모드 공용. */
export function EarningsEventPopup({ state, onClose, onSelectStock, onSelectEvent }: Props) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm bg-surface rounded-xl border border-gray-200 shadow-lg p-4"
        onClick={(e) => e.stopPropagation()}
      >
        {state.mode === 'event' ? (
          <EventDetail event={state.event} onClose={onClose} onSelectStock={onSelectStock} />
        ) : (
          <DayList
            date={state.date}
            events={state.events}
            onClose={onClose}
            onSelectEvent={onSelectEvent}
          />
        )}
      </div>
    </div>
  );
}

function PopupHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      <button
        type="button"
        aria-label="닫기"
        onClick={onClose}
        className="text-gray-400 hover:text-gray-700 text-lg leading-none px-1"
      >
        ×
      </button>
    </div>
  );
}

function EventDetail({
  event,
  onClose,
  onSelectStock,
}: {
  event: EarningsEvent;
  onClose: () => void;
  onSelectStock: (stock: SelectedStock) => void;
}) {
  const dayLabel = event.time ? `${formatDayLabel(event.date)} · ${event.time}` : formatDayLabel(event.date);

  return (
    <>
      <PopupHeader title={dayLabel} onClose={onClose} />

      <span className={`inline-block text-[10px] font-medium rounded px-1.5 py-0.5 ${CATEGORY_BADGE[event.category]}`}>
        {CATEGORY_LABEL[event.category]}
      </span>

      <div className="mt-2 flex items-center gap-1.5 flex-wrap">
        <span className="text-base font-semibold text-gray-900">{event.name}</span>
        {event.watched && <span className="text-red-500" title="관심종목">♥</span>}
        <span className="text-xs text-gray-400">{event.market}{event.sector ? ` · ${event.sector}` : ''}</span>
      </div>

      <p className="mt-2 text-sm text-gray-600">{event.report_nm}</p>

      {event.source_date && (
        <p className="mt-2 text-xs text-amber-700 bg-amber-50 rounded px-2 py-1.5">
          {formatMonthDay(event.source_date)} 공시 → 이 날짜 예정
        </p>
      )}

      {event.url && (
        <a
          href={event.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 block text-sm text-blue-600 hover:underline"
        >
          DART 원문 보기 ↗
        </a>
      )}

      <button
        type="button"
        onClick={() => {
          onClose();
          onSelectStock({ ticker: event.ticker, name: event.name, market: event.market, sector: event.sector });
        }}
        className="mt-4 w-full px-3 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700"
      >
        종목 상세 보기
      </button>
    </>
  );
}

function DayList({
  date,
  events,
  onClose,
  onSelectEvent,
}: {
  date: string;
  events: EarningsEvent[];
  onClose: () => void;
  onSelectEvent: (event: EarningsEvent) => void;
}) {
  return (
    <>
      <PopupHeader title={formatDayLabel(date)} onClose={onClose} />
      <ul className="flex flex-col gap-1 max-h-96 overflow-y-auto">
        {sortEarningsEvents(events).map((e) => (
          <li key={e.rcept_no}>
            <button
              type="button"
              onClick={() => onSelectEvent(e)}
              className="w-full flex items-center gap-2 text-left px-2 py-1.5 rounded-lg hover:bg-gray-50"
            >
              <span className="shrink-0 w-11 text-xs text-gray-500 tabular-nums text-right">
                {e.time ?? ''}
              </span>
              <span className={`shrink-0 w-16 text-center text-[10px] font-medium rounded px-1.5 py-0.5 ${CATEGORY_BADGE[e.category]}`}>
                {CATEGORY_LABEL[e.category]}
              </span>
              <span className="text-sm font-medium text-gray-900 truncate">
                {e.watched ? '♥ ' : ''}{e.name}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
