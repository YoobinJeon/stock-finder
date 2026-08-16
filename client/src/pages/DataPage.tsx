import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../shared/api/client';
import { API } from '../shared/api/endpoints';

interface DataSummary {
  stocks: number;
  /** 상장폐지 자동 감지로 비활성화된 종목 수 */
  inactiveStocks: number;
  financials: number;
  prices: number;
  scores: number;
  lastRun: { scope: string; status: string; started_at: string; finished_at: string | null } | null;
  /** 데이터 신선도 — 서버가 계산해 내려주지만 이 화면에서 쓰지 않고 있었다 */
  freshness?: { latestTradeDate: string | null; businessDaysBehind: number | null };
  /**
   * 기업 액션(액면병합·감자)이 원천에 소급 반영되지 않아 종가 눈금이 튄 종목.
   * 재정합이 KIS·Yahoo 양쪽을 시도하고도 못 고친 것들이 여기 남는다 — 월간 상승률이
   * 이 종목들의 해당 달을 제외하는 근거라, 숫자만이 아니라 **어느 종목인지** 보여야 한다.
   */
  priceBreaks?: { count: number; items: Array<{ ticker: string; name: string }> };
}

interface JobStatus {
  status: 'idle' | 'running' | 'done' | 'error';
  scope: string | null;
  phase: string | null;
  total: number;
  done: number;
  failed: string[];
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
}

/**
 * 소요시간은 실측값이다. `long: true`인 범위는 실행 전 확인을 받는다.
 */
const SCOPES = [
  { id: 'top200',      name: '시총 상위 200',  desc: '약 2~3분 · 처음이라면 이것부터', long: false },
  { id: 'kospi',       name: 'KOSPI 전체',     desc: '약 5~8분', long: true },
  { id: 'all',         name: '전체 시장',       desc: 'KOSPI+KOSDAQ 약 2,700종목 · 30분~1시간+', long: true },
  { id: 'financials',  name: '재무만 갱신',     desc: '보유 종목의 재무·컨센서스만 재수집 후 재채점 · 5~7분', long: false },
  { id: 'disclosures', name: '공시만 갱신',     desc: 'DART 공시 수집 후 재채점 (이벤트 룰 반영) · 2~3분', long: false },
  { id: 'rescore',     name: '점수만 재계산',   desc: '수집 없이 저장된 데이터로 재채점 · 1~2분', long: false },
  { id: 'prices',      name: '시세만 갱신',     desc: '재무·수급·공시 없이 시세·지표·점수만 · 중간', long: false },
];

/** 최신 거래일로부터 경과한 영업일 수 (없으면 0으로 취급) */
function behindDays(freshness: DataSummary['freshness']): number {
  return freshness?.businessDaysBehind ?? 0;
}

function SummaryCard({ label, value, unit }: { label: string; value?: number; unit: string }) {
  return (
    <div className="bg-surface rounded-xl p-4 border border-gray-200">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="text-2xl font-bold text-gray-900 mt-1">
        {value != null ? value.toLocaleString() : '—'}
        <span className="text-sm font-normal text-gray-400 ml-1">{unit}</span>
      </p>
    </div>
  );
}

export function DataPage() {
  const qc = useQueryClient();
  const [scope, setScope] = useState('top200');

  const { data: status } = useQuery<JobStatus>({
    queryKey: ['data', 'status'],
    queryFn: () => apiClient.get(API.data.status).then((r) => r.data),
    refetchInterval: (query) => (query.state.data?.status === 'running' ? 1500 : false),
  });

  const running = status?.status === 'running';

  const { data: summary } = useQuery<DataSummary>({
    queryKey: ['data', 'summary'],
    queryFn: () => apiClient.get(API.data.summary).then((r) => r.data),
    refetchInterval: running ? 5000 : false,
  });

  // 수집이 끝나면 화면 전체 데이터 갱신
  const prevStatus = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (prevStatus.current === 'running' && (status?.status === 'done' || status?.status === 'error')) {
      qc.invalidateQueries();
    }
    prevStatus.current = status?.status;
  }, [status?.status, qc]);

  const refresh = useMutation({
    mutationFn: () => apiClient.post(API.data.refresh, { scope }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['data'] }),
  });

  const progressPct = status && status.total > 0
    ? Math.min(100, Math.round((status.done / status.total) * 100))
    : null;

  return (
    <div className="p-6 max-w-4xl">
      <h2 className="text-xl font-bold text-gray-900 mb-1">데이터 관리</h2>
      <p className="text-sm text-gray-500 mb-6">
        네이버 금융·한국투자증권 OpenAPI·DART에서 종목/재무/시세/공시를 수집하고 점수를 다시 계산합니다.
      </p>

      {/* 보유 현황 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <SummaryCard label="종목"        value={summary?.stocks}     unit="개" />
        <SummaryCard label="재무 데이터" value={summary?.financials} unit="종목" />
        <SummaryCard label="시세 데이터" value={summary?.prices}     unit="종목" />
        <SummaryCard label="점수 계산"   value={summary?.scores}     unit="종목" />
      </div>

      {/* 신선도·비활성 종목 — 서버가 이미 계산해 내려주던 값(·)을 노출.
          "종목 2,766개"만 보면 그 데이터가 언제 것인지 알 수 없어 오래된 수치를 최신으로 오인한다. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-6 text-xs">
        {summary?.freshness?.latestTradeDate && (
          <span className={behindDays(summary.freshness) >= 2 ? 'text-amber-600 font-medium' : 'text-gray-500'}>
            {behindDays(summary.freshness) >= 2 ? '⚠️ ' : ''}
            시세 기준일 {summary.freshness.latestTradeDate}
            {behindDays(summary.freshness) > 0 && ` · ${behindDays(summary.freshness)}영업일 전`}
          </span>
        )}
        {summary != null && summary.inactiveStocks > 0 && (
          <span className="text-gray-400">
            비활성(상장폐지 감지) {summary.inactiveStocks.toLocaleString()}종목 제외
          </span>
        )}
        {summary?.lastRun?.finished_at && (
          <span className="text-gray-400">
            마지막 수집 {new Date(summary.lastRun.finished_at).toLocaleString('ko-KR')} ({summary.lastRun.scope} · {summary.lastRun.status})
          </span>
        )}
      </div>

      {summary?.priceBreaks != null && summary.priceBreaks.count > 0 && (
        <PriceBreaksNotice breaks={summary.priceBreaks} />
      )}

      {/* 수집 실행 */}
      <div className="bg-surface rounded-xl border border-gray-200 p-5">
        <h3 className="font-semibold text-gray-900 mb-4">데이터 수집</h3>

        <div className="flex flex-col gap-2 mb-5">
          {SCOPES.map((s) => (
            <label
              key={s.id}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg border cursor-pointer transition-colors ${
                scope === s.id ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'
              } ${running ? 'opacity-60 pointer-events-none' : ''}`}
            >
              <input
                type="radio"
                name="scope"
                value={s.id}
                checked={scope === s.id}
                onChange={() => setScope(s.id)}
                className="accent-blue-600"
              />
              <div>
                <p className="text-sm font-medium text-gray-900">{s.name}</p>
                <p className="text-xs text-gray-400">{s.desc}</p>
              </div>
            </label>
          ))}
        </div>

        {running ? (
          <div>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-gray-600 font-medium">{status?.phase ?? '진행 중'}…</span>
              <span className="text-gray-400">
                {status && status.total > 0 ? `${status.done}/${status.total}` : ''}
                {status && status.failed.length > 0 ? ` · 실패 ${status.failed.length}` : ''}
              </span>
            </div>
            <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
              <div
                className={`h-full bg-blue-500 rounded-full transition-all duration-500 ${progressPct == null ? 'animate-pulse w-1/3' : ''}`}
                style={progressPct != null ? { width: `${progressPct}%` } : undefined}
              />
            </div>
            <p className="text-xs text-gray-400 mt-2">
              수집 중에도 다른 화면을 사용할 수 있습니다. 완료되면 점수가 자동 갱신됩니다.
            </p>
          </div>
        ) : (
          <button
            onClick={() => {
              // 오래 걸리는 범위는 확인을 받는다 — 전체 시장은 30분~1시간+가 걸리고
              // 그동안 다른 수집을 시작할 수 없다(JobRunner는 동시 1잡).
              const picked = SCOPES.find((s) => s.id === scope);
              if (picked?.long && !confirm(`'${picked.name}' 수집은 ${picked.desc.split('·').pop()?.trim()} 걸립니다.\n진행하는 동안 다른 수집은 시작할 수 없습니다. 계속할까요?`)) {
                return;
              }
              refresh.mutate();
            }}
            disabled={refresh.isPending}
            className="w-full sm:w-auto px-6 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {refresh.isPending ? '시작하는 중…' : '데이터 수집 시작'}
          </button>
        )}

        {status?.status === 'done' && !running && (
          <p className="text-sm text-emerald-600 mt-3">
            ✅ 수집 완료{status.finishedAt ? ` (${new Date(status.finishedAt).toLocaleTimeString('ko-KR')})` : ''}
            {status.failed.length > 0 && (
              <span className="text-gray-400"> · 실패 {status.failed.length}건: {status.failed.slice(0, 5).join(', ')}{status.failed.length > 5 ? ' …' : ''}</span>
            )}
          </p>
        )}
        {status?.status === 'error' && (
          <p className="text-sm text-red-500 mt-3">⚠️ 수집 실패: {status.error}</p>
        )}
      </div>

      <p className="text-xs text-gray-400 mt-6">
        데이터 출처: 네이버 금융(종목·재무·업종), 한국투자증권 OpenAPI(일봉 시세 정본 · Yahoo Finance 폴백),
        KRX(수급), DART(공시). 공개 데이터라 지연·누락이 있을 수 있습니다.
      </p>
    </div>
  );
}


/**
 * 가격 파손 종목 안내.
 *
 * 기업 액션이 원천에 소급 반영되지 않아 하루 만에 종가가 몇 배로 튄 종목들이다. 재정합이
 * KIS·Yahoo 양쪽을 시도하고도 못 고친 것만 남으므로, 여기 있다는 건 **우리가 손쓸 수 없다**는
 * 뜻이다. 숫자만 세지 않고 종목명을 그대로 펼쳐 보여 준다 — 월간 상승률이 "N종목 제외"라고
 * 말할 때 그 N이 누구인지 확인할 곳이 여기다.
 */
function PriceBreaksNotice({ breaks }: {
  breaks: { count: number; items: Array<{ ticker: string; name: string }> };
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="text-sm text-amber-800 hover:text-amber-900 focus:outline-none
          focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-500"
      >
        <span className="mr-1 text-amber-500">{open ? '▾' : '▸'}</span>
        가격 파손 <b>{breaks.count}종목</b> — 액면병합·감자가 원천에 반영되지 않아 종가 눈금이
        튀었습니다. 재정합으로 고칠 수 없어 월간 상승률에서 해당 달을 제외합니다.
      </button>
      {open && (
        <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-amber-700">
          {breaks.items.map((s) => (
            <li key={s.ticker}>{s.name} <span className="text-amber-500">{s.ticker}</span></li>
          ))}
        </ul>
      )}
    </div>
  );
}
