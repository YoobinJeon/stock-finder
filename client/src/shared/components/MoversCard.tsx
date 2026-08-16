import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { API } from '../api/endpoints';
import { isKstMarketOpen } from '../lib/isKstMarketOpen';

interface MoverItem {
  ticker: string;
  name: string;
  price: number | null;
  changePct: number | null;
  amount: number | null;   // 거래대금 (백만원) — 52주 신고가·상한가·신규상장 보드는 null
  sector: string | null;
  totalScore: number | null;
  high52w?: number;
  streak?: number;         // 상한가 연속일수 (limitup 보드 전용)
  listedAt?: string;       // 상장일 YYYY-MM-DD (newListings 보드 전용)
  daysListed?: number;     // 상장 후 경과일 (newListings 보드 전용)
}

interface MoversResponse {
  intraday: boolean;
  asOf: string;
  amount: MoverItem[];
  surge: MoverItem[];
  high52w: MoverItem[];
  limitup: MoverItem[];
  limitupAsOf: string | null; // limitup 데이터 기준 최신 거래일 (EOD)
}

interface NewListingsResponse {
  items: MoverItem[];
}

type Board = 'amount' | 'surge' | 'high52w' | 'limitup' | 'newListings';

const BOARD_LABELS: Record<Board, string> = {
  amount: '거래대금',
  surge: '급등',
  high52w: '52주 신고가',
  limitup: '상한가',
  newListings: '신규상장',
};

/** YYYY-MM-DD → MM-DD */
function fmtMonthDay(dateStr: string): string {
  return dateStr.slice(5);
}

interface SelectedStock {
  ticker: string;
  name: string;
  market: string;
  sector?: string | null;
  total_score: number | null;
}

function fmtAmountMn(mn: number): string {
  const eok = mn / 100;
  if (eok >= 10000) return `${(eok / 10000).toFixed(1)}조`;
  return `${Math.round(eok).toLocaleString()}억`;
}

/** 오늘의 특징주 위젯 — 거래대금 상위·급등·52주 신고가·상한가·신규상장 (60초 갱신) */
export function MoversCard({ onSelect }: { onSelect: (s: SelectedStock) => void }) {
  const [board, setBoard] = useState<Board>('amount');

  const { data, isLoading } = useQuery<MoversResponse>({
    queryKey: ['movers'],
    queryFn: () => apiClient.get(API.market.movers).then((r) => r.data),
    refetchInterval: () => (isKstMarketOpen() ? 60 * 1000 : false), // 장중에만 60초 폴링
    staleTime: 50 * 1000,
  });

  // 신규상장은 stocks.listed_at 기준 별도 엔드포인트 — 90일 내 변동이 적어 느슨한 주기로 별도 조회
  const { data: newListingsData, isLoading: newListingsLoading } = useQuery<NewListingsResponse>({
    queryKey: ['newListings'],
    queryFn: () => apiClient.get(API.market.newListings).then((r) => r.data),
    enabled: board === 'newListings',
    staleTime: 5 * 60 * 1000,
  });

  const items = board === 'newListings' ? newListingsData?.items ?? [] : data?.[board] ?? [];
  const loading = board === 'newListings' ? newListingsLoading : isLoading;

  return (
    <div className="bg-surface rounded-xl border border-gray-200">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2 flex-wrap">
        <h3 className="font-semibold text-gray-900">⚡ 오늘의 특징주</h3>
        {data?.intraday && (
          <span className="text-[10px] font-medium text-red-500 bg-red-50 rounded px-1.5 py-0.5">
            ● 장중 {data.asOf}
          </span>
        )}
        <div className="ml-auto flex gap-1">
          {(Object.keys(BOARD_LABELS) as Board[]).map((b) => (
            <button
              key={b}
              onClick={() => setBoard(b)}
              className={`text-xs rounded-full px-2.5 py-1 border whitespace-nowrap ${
                board === b
                  ? 'bg-[#111827] text-white border-[#111827]'
                  : 'bg-surface text-gray-500 border-gray-200 hover:bg-gray-50'
              }`}
            >
              {BOARD_LABELS[b]}
            </button>
          ))}
        </div>
      </div>

      {loading && <p className="px-5 py-6 text-sm text-gray-400">불러오는 중…</p>}
      {!loading && items.length === 0 && (
        <p className="px-5 py-6 text-sm text-gray-400">
          {board === 'high52w' && '오늘 52주 신고가 종목이 없습니다.'}
          {board === 'limitup' && '최근 상한가 종목이 없습니다.'}
          {board === 'newListings' && '최근 신규상장이 없습니다.'}
          {board !== 'high52w' && board !== 'limitup' && board !== 'newListings' && '데이터가 없습니다.'}
        </p>
      )}

      <div className="divide-y divide-gray-50">
        {items.slice(0, 10).map((m, i) => (
          <button
            key={m.ticker}
            onClick={() =>
              onSelect({
                ticker: m.ticker,
                name: m.name,
                market: '',
                sector: m.sector,
                total_score: m.totalScore,
              })
            }
            disabled={m.totalScore == null && m.sector == null}
            className="w-full flex items-center gap-3 px-5 py-2.5 text-left hover:bg-gray-50 disabled:cursor-default"
          >
            <span className="text-xs text-gray-300 w-4">{i + 1}</span>
            <span className="flex-1 min-w-0 flex items-baseline gap-1.5">
              <span className="text-sm font-medium text-gray-900 truncate">{m.name}</span>
              {m.sector && <span className="text-xs text-gray-400 shrink-0">{m.sector}</span>}
              {board === 'limitup' && m.streak != null && (
                <span className="text-xs font-semibold text-orange-600 bg-orange-50 rounded px-1.5 py-0.5 whitespace-nowrap shrink-0">
                  🔥 {m.streak}일 연속
                </span>
              )}
            </span>
            {m.totalScore != null && (
              <span className="text-xs font-semibold text-blue-600 bg-blue-50 rounded px-1.5 py-0.5">
                {m.totalScore}
              </span>
            )}
            <span className="text-sm text-gray-800 w-20 text-right whitespace-nowrap">
              {m.price != null ? m.price.toLocaleString() : '-'}
            </span>
            <span
              className={`text-sm font-medium w-16 text-right whitespace-nowrap ${
                m.changePct == null ? 'text-gray-300'
                  : m.changePct > 0 ? 'text-red-600' : m.changePct < 0 ? 'text-blue-600' : 'text-gray-400'
              }`}
            >
              {m.changePct != null ? `${m.changePct >= 0 ? '+' : ''}${m.changePct.toFixed(2)}%` : '-'}
            </span>
            <span className="text-xs text-gray-400 w-20 text-right whitespace-nowrap hidden sm:block">
              {board === 'high52w' && (m.high52w != null ? `고${m.high52w.toLocaleString()}` : '')}
              {board === 'newListings' && m.listedAt != null
                && `${fmtMonthDay(m.listedAt)} · D+${m.daysListed}`}
              {board !== 'high52w' && board !== 'newListings' && m.amount != null ? fmtAmountMn(m.amount) : ''}
            </span>
          </button>
        ))}
      </div>

      <p className="px-5 py-2 text-[11px] text-gray-400 border-t border-gray-50">
        {board === 'limitup'
          ? `종가 기준 · ${data?.limitupAsOf ?? '-'} (당일 상한가는 저녁 수집 후 반영됩니다)`
          : board === 'newListings'
          ? '최근 90일 내 상장 종목 (네이버 상장일 기준). 현재가·등락률은 EOD 종가 기준.'
          : <>파란 배지 = 우리 종합점수 (없으면 수집 범위 밖·ETF). 52주 신고가는 자체 데이터 기준
            {data?.intraday ? ' + 장중 실시간 돌파 확정' : ' (마감 기준)'}.</>}
      </p>
    </div>
  );
}
