import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../shared/api/client';
import { API } from '../shared/api/endpoints';
import { StockDetailPanel } from '../shared/components/StockDetailPanel';
import { buildMonthGrid, currentMonth, shiftMonth, todayIso, WEEKDAY_LABELS } from './calendar/calendarMonth';
import { EarningsDayDetail } from './calendar/EarningsDayDetail';
import { EarningsEventPopup, type PopupState } from './calendar/EarningsEventPopup';
import { CATEGORY_CHIP, CATEGORY_DOT, CATEGORY_LABEL, sortEarningsEvents } from './calendar/earningsTypes';
import type { EarningsCalendarResponse, EarningsCategory, EarningsEvent } from './calendar/earningsTypes';

const MAX_CHIPS_PER_DAY = 3;
const LEGEND_CATEGORIES: EarningsCategory[] = [
  'provisional',
  'ir',
  'scheduled',
  'dividend',
  'listing',
  'periodic',
];

const MONTH_PARAM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function isValidMonthParam(raw: string | null): raw is string {
  return raw != null && MONTH_PARAM_RE.test(raw);
}

interface SelectedStock {
  ticker: string;
  name: string;
  market: string;
  sector: string | null;
}

/** 실적 캘린더 — disclosure_events(잠정실적·IR·배당기준일) + earnings_schedules(발표예정) +
 *  stocks.listed_at(신규상장)를 월간 달력에 표시.
 *  IR·발표예정·배당기준일은 예정일(기준일) 파싱 성공 시 접수일이 아닌 실제 예정일에 표시된다. */
export function CalendarPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const monthParam = searchParams.get('m');
  const month = isValidMonthParam(monthParam) ? monthParam : currentMonth();
  const today = todayIso();

  const [selectedDate, setSelectedDate] = useState<string | null>(
    month === currentMonth() ? today : null,
  );
  const [selectedStock, setSelectedStock] = useState<SelectedStock | null>(null);
  const [popup, setPopup] = useState<PopupState | null>(null);

  // 월이 바뀌면 선택 날짜를 리셋 — 해당 월이 이번 달이면 오늘, 아니면 미선택
  useEffect(() => {
    setSelectedDate(month === currentMonth() ? today : null);
    setPopup(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  const setMonth = (next: string) => {
    const params = new URLSearchParams(searchParams);
    params.set('m', next);
    setSearchParams(params, { replace: true });
  };

  const { data, isLoading, isError } = useQuery<EarningsCalendarResponse>({
    queryKey: ['calendar', 'earnings', month],
    queryFn: () => apiClient.get(`${API.calendar.earnings}?month=${month}`).then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });

  const grid = useMemo(() => buildMonthGrid(month), [month]);
  const days = data?.days ?? {};
  const total = data?.total ?? 0;
  const [year, monthNum] = month.split('-');
  const selectedEvents = selectedDate ? days[selectedDate] ?? [] : [];
  const showEmptyMonth = !isLoading && !isError && total === 0;

  const openEventPopup = (event: EarningsEvent, date: string) => {
    setSelectedDate(date);
    setPopup({ mode: 'event', event });
  };

  const openDayListPopup = (date: string, events: EarningsEvent[]) => {
    setSelectedDate(date);
    setPopup({ mode: 'dayList', date, events });
  };

  const handleSelectStock = (stock: SelectedStock) => {
    setPopup(null);
    setSelectedStock(stock);
  };

  return (
    <div className="p-6">
      {selectedStock && (
        <StockDetailPanel
          ticker={selectedStock.ticker}
          name={selectedStock.name}
          market={selectedStock.market}
          sector={selectedStock.sector}
          onClose={() => setSelectedStock(null)}
        />
      )}

      {popup && (
        <EarningsEventPopup
          state={popup}
          onClose={() => setPopup(null)}
          onSelectStock={handleSelectStock}
          onSelectEvent={(event) => setPopup({ mode: 'event', event })}
        />
      )}

      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <h2 className="text-xl font-bold text-gray-900">실적 캘린더</h2>
        <div className="flex items-center gap-4 text-xs text-gray-500 flex-wrap">
          {LEGEND_CATEGORIES.map((category) => (
            <span key={category} className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full inline-block ${CATEGORY_DOT[category]}`} />
              {CATEGORY_LABEL[category]}
            </span>
          ))}
          <span className="text-red-500">♥ 관심종목</span>
        </div>
      </div>

      <div className="bg-surface rounded-xl border border-gray-200 p-4 mb-4">
        <div className="flex items-center justify-center gap-3 mb-4">
          <button
            type="button"
            aria-label="이전 달"
            onClick={() => setMonth(shiftMonth(month, -1))}
            className="px-2 py-1 text-gray-500 hover:text-gray-900 text-lg leading-none"
          >
            ‹
          </button>
          <span className="text-base font-semibold text-gray-900 w-28 text-center">
            {year}년 {Number(monthNum)}월
          </span>
          <button
            type="button"
            aria-label="다음 달"
            onClick={() => setMonth(shiftMonth(month, 1))}
            className="px-2 py-1 text-gray-500 hover:text-gray-900 text-lg leading-none"
          >
            ›
          </button>
          <button
            type="button"
            onClick={() => setMonth(currentMonth())}
            className="ml-2 px-3 py-1 text-xs font-medium rounded-full bg-blue-50 text-blue-600 hover:bg-blue-100"
          >
            오늘
          </button>
        </div>

        {isLoading ? (
          <p className="text-sm text-gray-400 py-10 text-center">불러오는 중…</p>
        ) : isError ? (
          <p className="text-sm text-red-500 py-10 text-center">캘린더 데이터를 불러오지 못했습니다.</p>
        ) : (
          <>
            <div className="grid grid-cols-7 mb-1">
              {WEEKDAY_LABELS.map((label, i) => (
                <div
                  key={label}
                  className={`text-center text-xs font-medium py-1 ${
                    i === 0 ? 'text-red-500' : i === 6 ? 'text-blue-500' : 'text-gray-400'
                  }`}
                >
                  {label}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {grid.map((cell, i) => {
                if (!cell.inMonth) {
                  return <div key={`blank-${i}`} className="aspect-square rounded-lg bg-gray-50/60" />;
                }
                const events = sortEarningsEvents(days[cell.date] ?? []);
                const isToday = cell.date === today;
                const isSelected = cell.date === selectedDate;
                return (
                  <div
                    role="button"
                    tabIndex={0}
                    key={cell.date}
                    onClick={() => setSelectedDate(cell.date)}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter' && e.key !== ' ') return;
                      e.preventDefault();
                      setSelectedDate(cell.date);
                    }}
                    className={`aspect-square rounded-lg border p-1 flex flex-col items-start text-left overflow-hidden transition-colors cursor-pointer ${
                      isSelected ? 'border-blue-300 bg-blue-50' : 'border-gray-100 hover:bg-gray-50'
                    }`}
                  >
                    <span
                      className={`text-xs font-medium w-5 h-5 shrink-0 flex items-center justify-center rounded-full ${
                        isToday ? 'ring-2 ring-blue-400 text-blue-600' : 'text-gray-700'
                      }`}
                    >
                      {cell.day}
                    </span>
                    {/* md 미만: 점 표시 */}
                    <div className="flex md:hidden gap-0.5 mt-1 flex-wrap">
                      {events.slice(0, MAX_CHIPS_PER_DAY).map((e) => (
                        <span key={e.rcept_no} className={`w-1.5 h-1.5 rounded-full ${CATEGORY_DOT[e.category]}`} />
                      ))}
                    </div>
                    {/* md 이상: 종목명 칩 표시 — 개별 클릭 시 이벤트 팝업 */}
                    <div className="hidden md:flex flex-col gap-0.5 mt-1 w-full min-w-0">
                      {events.slice(0, MAX_CHIPS_PER_DAY).map((e) => (
                        <button
                          type="button"
                          key={e.rcept_no}
                          onClick={(ev) => {
                            ev.stopPropagation();
                            openEventPopup(e, cell.date);
                          }}
                          className={`text-[10px] leading-tight rounded px-1 py-0.5 truncate w-full text-left transition-colors hover:brightness-95 ${CATEGORY_CHIP[e.category]}`}
                        >
                          {e.watched ? '♥ ' : ''}{e.time ? `${e.time} ` : ''}{e.name}
                        </button>
                      ))}
                      {events.length > MAX_CHIPS_PER_DAY && (
                        <button
                          type="button"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            openDayListPopup(cell.date, events);
                          }}
                          className="text-[10px] text-gray-400 hover:text-gray-600 text-left"
                        >
                          +{events.length - MAX_CHIPS_PER_DAY}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {showEmptyMonth ? (
        <div className="bg-surface rounded-xl border border-gray-200 p-6 text-center">
          <p className="text-sm text-gray-500">이 달 실적 관련 공시가 없습니다.</p>
          <p className="text-xs text-gray-400 mt-1">
            실적 공시(잠정실적·IR)가 뜨는 날짜에 자동 표시됩니다.
          </p>
        </div>
      ) : (
        !isLoading && !isError && (
          <EarningsDayDetail date={selectedDate} events={selectedEvents} onSelectStock={setSelectedStock} />
        )
      )}
    </div>
  );
}
