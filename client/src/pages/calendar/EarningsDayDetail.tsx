import { WEEKDAY_LABELS } from './calendarMonth';
import { CATEGORY_BADGE, CATEGORY_LABEL, sortEarningsEvents } from './earningsTypes';
import type { EarningsEvent } from './earningsTypes';

interface SelectedStock {
  ticker: string;
  name: string;
  market: string;
  sector: string | null;
}

interface Props {
  date: string | null;
  events: EarningsEvent[];
  onSelectStock: (stock: SelectedStock) => void;
}

function formatDayLabel(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}-${dd} (${WEEKDAY_LABELS[d.getDay()]})`;
}

/** 선택된 날짜의 실적 관련 공시 상세 목록 — 종목명 클릭 시 종목 상세 패널을 연다. */
export function EarningsDayDetail({ date, events, onSelectStock }: Props) {
  if (!date) {
    return (
      <div className="bg-surface rounded-xl border border-gray-200 p-6 text-center">
        <p className="text-sm text-gray-400">날짜를 선택하면 상세 공시 목록이 표시됩니다.</p>
      </div>
    );
  }

  return (
    <div className="bg-surface rounded-xl border border-gray-200 p-4">
      <h3 className="text-sm font-semibold text-gray-900 mb-3">{formatDayLabel(date)}</h3>
      {events.length === 0 ? (
        <p className="text-sm text-gray-400">이 날짜엔 실적 관련 공시가 없습니다.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {sortEarningsEvents(events).map((e) => (
            <li key={e.rcept_no} className="flex items-center gap-2 flex-wrap text-sm">
              <span className="shrink-0 w-11 text-xs text-gray-500 tabular-nums text-right">
                {e.time ?? ''}
              </span>
              <span className={`shrink-0 w-16 text-center text-[10px] font-medium rounded px-1.5 py-0.5 ${CATEGORY_BADGE[e.category]}`}>
                {CATEGORY_LABEL[e.category]}
              </span>
              <button
                type="button"
                onClick={() => onSelectStock({ ticker: e.ticker, name: e.name, market: e.market, sector: e.sector })}
                className="font-medium text-gray-900 hover:text-blue-600 hover:underline"
              >
                {e.name}
              </button>
              {e.watched && <span className="text-red-500" title="관심종목">♥</span>}
              {e.url ? (
                <a
                  href={e.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-500 hover:text-blue-600 hover:underline truncate max-w-full"
                >
                  {e.report_nm}
                </a>
              ) : (
                <span className="text-gray-500 truncate max-w-full">{e.report_nm}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
