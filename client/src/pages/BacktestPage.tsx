import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../shared/api/client';
import { API } from '../shared/api/endpoints';

interface StrategyEvalItem {
  id: string | null;
  key?: string;
  name: string;
  desc?: string;
  criteria: Record<string, unknown>;
  count: number;
  avgRet: number;
  winRate: number;
  excess: number;
  skipped: string[];
}

interface StrategyEvalResult {
  baseDate: string;
  latestDate: string;
  universe: number;
  universeAvg: number;
  presets: StrategyEvalItem[];
  candidates: StrategyEvalItem[];
}

interface TopStock {
  ticker: string;
  name: string;
  market: string;
  sector: string | null;
  score: number;
  base_price: number;
  now_price: number;
  ret: number;
}

interface BacktestResult {
  baseDate: string;
  latestDate: string;
  monthsAgo: number;
  universe: number;
  topN: TopStock[];
  topAvg: number;
  allAvg: number;
  median: number;
  quintiles: Array<{ label: string; avgRet: number; count: number }>;
  excluded: string[];
}

const PERIODS = [
  { months: 1, label: '1개월 전' },
  { months: 3, label: '3개월 전' },
  { months: 6, label: '6개월 전' },
];

function pct(v: number): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}

function RetText({ v, bold }: { v: number; bold?: boolean }) {
  return (
    <span className={`${v >= 0 ? 'text-red-500' : 'text-blue-500'} ${bold ? 'font-bold' : ''}`}>
      {pct(v)}
    </span>
  );
}

export function BacktestPage() {
  const [mode, setMode] = useState<'pit' | 'history'>('pit');
  const [months, setMonths] = useState(3);
  const [asOf, setAsOf] = useState('');
  const [copied, setCopied] = useState(false);

  const { data: historyDates = [] } = useQuery<Array<{ as_of: string; count: number }>>({
    queryKey: ['backtest', 'history-dates'],
    queryFn: () => apiClient.get(API.backtest.historyDates).then((r) => r.data),
  });

  // 선택 가능한 기준일 = 최신 거래일 이전 날짜 (전방 수익률 구간 필요)
  const usableDates = historyDates.slice(1);

  const run = useMutation<BacktestResult, any, void>({
    mutationFn: () =>
      apiClient.post(API.backtest.run,
        mode === 'history'
          ? { mode, asOf: asOf || usableDates[0]?.as_of, top: 20 }
          : { mode, monthsAgo: months, top: 20 },
      ).then((r) => r.data),
  });

  const result = run.data;

  const copyShare = async () => {
    if (!result) return;
    const outperf = result.topAvg - result.allAvg;
    const lines = [
      `🧪 Stock Finder 백테스트 (${result.baseDate} → ${result.latestDate})`,
      '',
      `당시 데이터만으로 채점한 점수 상위 20종목의 이후 실제 수익률:`,
      `· 상위 20종목 평균: ${pct(result.topAvg)}`,
      `· 전체 시장 평균(${result.universe.toLocaleString()}종목): ${pct(result.allAvg)}`,
      `· 초과수익: ${pct(outperf)}`,
      '',
      '점수 분위별 평균 수익률 (Q5=점수 최상위 20%):',
      ...[...result.quintiles].reverse().map((qt) => `· ${qt.label}: ${pct(qt.avgRet)}`),
      '',
      '상위 종목:',
      ...result.topN.slice(0, 10).map((s) => `· ${s.name} (${s.score}점) → ${pct(s.ret)}`),
      '',
      '⚠️ 과거 성과가 미래 수익을 보장하지 않습니다. 투자 권유가 아닙니다.',
    ];
    await navigator.clipboard.writeText(lines.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const maxAbs = result ? Math.max(...result.quintiles.map((qt) => Math.abs(qt.avgRet)), 1) : 1;

  return (
    <div className="p-6 max-w-5xl">
      <h2 className="text-xl font-bold text-gray-900 mb-1">백테스트 — 점수 모델 검증</h2>
      <p className="text-sm text-gray-500 mb-6">
        과거 시점에 <b>당시 알려졌던 데이터만으로</b> 점수를 다시 계산하고(미래 정보 차단),
        점수 상위 종목이 이후 실제로 시장을 이겼는지 확인합니다.
      </p>

      {/* 실행 컨트롤 */}
      <div className="bg-surface rounded-xl border border-gray-200 p-5 mb-6">
        {/* 모드 선택 */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setMode('pit')}
            className={`text-sm px-4 py-2 rounded-lg border transition-colors ${
              mode === 'pit' ? 'bg-blue-600 border-blue-600 text-white' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            시점 재계산 (4팩터 근사)
          </button>
          <button
            onClick={() => setMode('history')}
            disabled={usableDates.length === 0}
            title={usableDates.length === 0 ? '점수 이력이 쌓이면 사용 가능합니다 (매일 수집 시 자동 축적)' : ''}
            className={`text-sm px-4 py-2 rounded-lg border transition-colors disabled:opacity-40 ${
              mode === 'history' ? 'bg-blue-600 border-blue-600 text-white' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            기록 기반 (5팩터 완전판)
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {mode === 'pit' ? (
            <>
              <span className="text-sm text-gray-600">기준 시점:</span>
              {PERIODS.map((p) => (
                <button
                  key={p.months}
                  onClick={() => setMonths(p.months)}
                  className={`text-sm px-4 py-2 rounded-lg border transition-colors ${
                    months === p.months
                      ? 'bg-blue-50 border-blue-400 text-blue-700'
                      : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </>
          ) : (
            <>
              <span className="text-sm text-gray-600">채점 기록일:</span>
              <select
                value={asOf || usableDates[0]?.as_of || ''}
                onChange={(e) => setAsOf(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {usableDates.map((d) => (
                  <option key={d.as_of} value={d.as_of}>{d.as_of} ({d.count.toLocaleString()}종목)</option>
                ))}
              </select>
              <span className="text-xs text-gray-400">수집할 때마다 그날의 점수가 기록됩니다</span>
            </>
          )}
          <button
            onClick={() => run.mutate()}
            disabled={run.isPending || (mode === 'history' && usableDates.length === 0)}
            className="ml-auto px-6 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {run.isPending ? '검증 중…' : '백테스트 실행'}
          </button>
        </div>
        {mode === 'history' && usableDates.length === 0 && (
          <p className="text-xs text-amber-600 mt-3">
            아직 전방 수익률을 잴 수 있는 과거 기록이 없습니다. 매일 수집이 쌓이면 이 모드로
            수급·기술 포함 실제 저장 점수 그대로 검증할 수 있습니다.
          </p>
        )}
      </div>

      {run.isError && (
        <p className="text-sm text-red-500 mb-6">
          ⚠️ {(run.error as any)?.response?.data?.error ?? '백테스트 실행에 실패했습니다.'}
        </p>
      )}

      {result && (
        <>
          {/* 요약 */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
            <div className="bg-surface rounded-xl p-4 border border-gray-200">
              <p className="text-sm text-gray-500">상위 20종목 평균</p>
              <p className="text-2xl mt-1"><RetText v={result.topAvg} bold /></p>
            </div>
            <div className="bg-surface rounded-xl p-4 border border-gray-200">
              <p className="text-sm text-gray-500">전체 평균 ({result.universe.toLocaleString()}종목)</p>
              <p className="text-2xl mt-1"><RetText v={result.allAvg} bold /></p>
            </div>
            <div className="bg-surface rounded-xl p-4 border border-gray-200">
              <p className="text-sm text-gray-500">초과수익 (상위20 − 전체)</p>
              <p className="text-2xl mt-1"><RetText v={Math.round((result.topAvg - result.allAvg) * 100) / 100} bold /></p>
            </div>
            <div className="bg-surface rounded-xl p-4 border border-gray-200">
              <p className="text-sm text-gray-500">전체 중앙값</p>
              <p className="text-2xl mt-1"><RetText v={result.median} bold /></p>
            </div>
          </div>

          {/* 분위별 수익률 */}
          <div className="bg-surface rounded-xl border border-gray-200 p-5 mb-6">
            <div className="flex items-baseline justify-between mb-4">
              <h3 className="font-semibold text-gray-900">점수 분위별 평균 수익률</h3>
              <span className="text-xs text-gray-400">
                {result.baseDate} 기준 채점 → {result.latestDate}까지 수익률 · Q5 = 점수 최상위 20%
              </span>
            </div>
            <div className="flex flex-col gap-2">
              {result.quintiles.map((qt) => (
                <div key={qt.label} className="flex items-center gap-3">
                  <span className="w-8 text-xs font-medium text-gray-500">{qt.label}</span>
                  <div className="flex-1 h-6 relative">
                    <div
                      className={`h-full rounded ${qt.avgRet >= 0 ? 'bg-red-400/80' : 'bg-blue-400/80'}`}
                      style={{ width: `${(Math.abs(qt.avgRet) / maxAbs) * 100}%` }}
                    />
                  </div>
                  <span className="w-20 text-right text-sm"><RetText v={qt.avgRet} /></span>
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-3">
              Q5→Q1로 갈수록 수익률이 낮아지면 점수가 수익률을 실제로 구분한다는 뜻입니다.
              {result.excluded.length > 0
                ? ` 제외 팩터: ${result.excluded.join(', ')}`
                : ' 저장 시점의 5팩터 점수(수급·기술 포함) 그대로 검증했습니다.'}
            </p>
          </div>

          {/* 상위 종목 */}
          <div className="bg-surface rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900 text-sm">
                {result.baseDate} 시점 점수 상위 20종목
              </h3>
              <button
                onClick={copyShare}
                className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                {copied ? '✅ 복사됨!' : '📋 결과 공유 텍스트 복사'}
              </button>
            </div>
            <table className="w-full text-sm whitespace-nowrap">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-xs text-gray-500">
                  <th className="text-left px-5 py-2.5 font-medium">종목명</th>
                  <th className="text-right px-3 py-2.5 font-medium">당시 점수</th>
                  <th className="text-right px-3 py-2.5 font-medium">당시 가격</th>
                  <th className="text-right px-3 py-2.5 font-medium">현재 가격</th>
                  <th className="text-right px-5 py-2.5 font-medium">수익률</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {result.topN.map((s) => (
                  <tr key={s.ticker}>
                    <td className="px-5 py-2.5">
                      <span className="font-medium text-gray-900">{s.name}</span>
                      <span className="ml-2 text-xs text-gray-400">{s.ticker} · {s.market}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right text-gray-700">{s.score}점</td>
                    <td className="px-3 py-2.5 text-right text-gray-500">{s.base_price.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-right text-gray-700">{s.now_price.toLocaleString()}</td>
                    <td className="px-5 py-2.5 text-right"><RetText v={s.ret} bold /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-gray-400 mt-4">
            ⚠️ 단순화된 검증입니다: 생존 편향(현재 상장 종목만), 거래비용·유동성 미반영,
            재무 공시 시점은 근사치(3월말 가정). 과거 성과가 미래 수익을 보장하지 않습니다.
          </p>
        </>
      )}

      {!result && !run.isPending && (
        <div className="bg-surface rounded-xl border border-gray-200 p-10 text-center text-sm text-gray-400">
          기준 시점을 선택하고 실행하면, 그 시점의 점수 상위 종목이 이후 어떤 성과를 냈는지 보여줍니다.
        </div>
      )}

      <StrategyEvalSection />
    </div>
  );
}

/** 전략 성과 검증 + 데이터 기반 전략 탐색 (3·6개월 동시 평가) */
function StrategyEvalSection() {
  const qc = useQueryClient();
  const [copiedSaved, setCopiedSaved] = useState<string | null>(null);

  const evalRun = useMutation<{ m3: StrategyEvalResult; m6: StrategyEvalResult }, any, void>({
    mutationFn: async () => {
      const [m3, m6] = await Promise.all([
        apiClient.post(API.backtest.strategies, { monthsAgo: 3 }).then((r) => r.data),
        apiClient.post(API.backtest.strategies, { monthsAgo: 6 }).then((r) => r.data),
      ]);
      return { m3, m6 };
    },
  });

  const savePreset = useMutation({
    mutationFn: (c: StrategyEvalItem) =>
      apiClient.post(API.screener.presets, {
        name: c.name,
        description: `${c.desc ?? ''} (전략 탐색 추천)`,
        criteria: c.criteria,
      }),
    onSuccess: (_d, c) => {
      qc.invalidateQueries({ queryKey: ['screener', 'presets'] });
      setCopiedSaved(c.key ?? c.name);
      setTimeout(() => setCopiedSaved(null), 2500);
    },
  });

  const d = evalRun.data;

  // 6개월 결과를 이름으로 매칭
  const m6ByName = new Map<string, StrategyEvalItem>();
  if (d) {
    for (const p of d.m6.presets) m6ByName.set(p.name, p);
    for (const c of d.m6.candidates) m6ByName.set(c.name, c);
  }

  const fmtRet = (v: number) => (
    <span className={v >= 0 ? 'text-red-500' : 'text-blue-500'}>{v >= 0 ? '+' : ''}{v.toFixed(1)}%</span>
  );

  // 후보 중 이미 저장된 전략(같은 이름)과 겹치지 않는 것, 3·6개월 평균 초과수익 순
  const rankedCandidates = d
    ? [...d.m3.candidates]
        .map((c) => {
          const six = m6ByName.get(c.name);
          return { ...c, excess6: six?.excess ?? null, avgExcess: six ? (c.excess + six.excess) / 2 : c.excess };
        })
        .sort((a, b) => b.avgExcess - a.avgExcess)
        .slice(0, 6)
    : [];

  return (
    <div className="mt-10">
      <div className="flex items-start justify-between gap-4 mb-1">
        <h2 className="text-xl font-bold text-gray-900">전략 성과 검증 · 탐색</h2>
        <button
          onClick={() => evalRun.mutate()}
          disabled={evalRun.isPending}
          className="shrink-0 px-6 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {evalRun.isPending ? '검증 중… (3·6개월 동시)' : '전략 검증 실행'}
        </button>
      </div>
      <p className="text-sm text-gray-500 mb-5">
        보유 중인 전략들이 과거에 실제로 시장을 이겼는지 검증하고, 데이터가 찾은 더 나은 조건 조합을 제안합니다.
        (수급 조건은 과거 수급 이력이 충분히 쌓이면 자동으로 검증에 포함, 부족하면 '수급 제외' 표시)
      </p>

      {evalRun.isError && (
        <p className="text-sm text-red-500 mb-4">⚠️ {(evalRun.error as any)?.response?.data?.error ?? '검증 실패'}</p>
      )}

      {d && (
        <>
          {/* 기존 전략 성과 */}
          <div className="bg-surface rounded-xl border border-gray-200 overflow-hidden mb-6">
            <div className="px-5 py-3 border-b border-gray-100 text-sm">
              <span className="font-semibold text-gray-900">내 전략 성과</span>
              <span className="ml-2 text-xs text-gray-400">
                3개월({d.m3.baseDate}~) 전체평균 {d.m3.universeAvg >= 0 ? '+' : ''}{d.m3.universeAvg}% ·
                6개월({d.m6.baseDate}~) 전체평균 {d.m6.universeAvg >= 0 ? '+' : ''}{d.m6.universeAvg}%
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm whitespace-nowrap">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50 text-xs text-gray-500">
                    <th className="text-left px-5 py-2.5 font-medium">전략</th>
                    <th className="text-right px-3 py-2.5 font-medium">3개월 수익률</th>
                    <th className="text-right px-3 py-2.5 font-medium">3개월 초과</th>
                    <th className="text-right px-3 py-2.5 font-medium">6개월 수익률</th>
                    <th className="text-right px-3 py-2.5 font-medium">6개월 초과</th>
                    <th className="text-right px-3 py-2.5 font-medium">승률(3M)</th>
                    <th className="text-right px-5 py-2.5 font-medium">종목수(3M)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {d.m3.presets.map((p) => {
                    const six = m6ByName.get(p.name);
                    return (
                      <tr key={p.name}>
                        <td className="px-5 py-2.5">
                          <span className="font-medium text-gray-900">{p.name}</span>
                          {p.skipped.length > 0 && (
                            <span className="ml-2 text-[10px] text-amber-600 border border-amber-200 rounded px-1 py-0.5"
                                  title="수급 조건은 과거 데이터가 없어 제외하고 검증">
                              수급 제외
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right">{p.count > 0 ? fmtRet(p.avgRet) : <span className="text-gray-300">표본 없음</span>}</td>
                        <td className="px-3 py-2.5 text-right font-medium">{p.count > 0 ? fmtRet(p.excess) : '—'}</td>
                        <td className="px-3 py-2.5 text-right">{six && six.count > 0 ? fmtRet(six.avgRet) : <span className="text-gray-300">—</span>}</td>
                        <td className="px-3 py-2.5 text-right font-medium">{six && six.count > 0 ? fmtRet(six.excess) : '—'}</td>
                        <td className="px-3 py-2.5 text-right text-gray-600">{p.count > 0 ? `${p.winRate}%` : '—'}</td>
                        <td className="px-5 py-2.5 text-right text-gray-500">{p.count}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* 데이터가 찾은 전략 후보 */}
          <div className="bg-surface rounded-xl border border-gray-200 p-5">
            <h3 className="font-semibold text-gray-900 text-sm mb-1">💡 데이터가 찾은 전략 후보 (3·6개월 평균 초과수익 순)</h3>
            <p className="text-xs text-gray-400 mb-4">15종목 이상 걸리는 조합만 표시 · 마음에 들면 바로 전략으로 저장하세요</p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {rankedCandidates.map((c) => (
                <div key={c.key ?? c.name} className="border border-gray-100 rounded-lg p-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium text-gray-900">{c.name}</p>
                    <button
                      onClick={() => savePreset.mutate(c)}
                      disabled={savePreset.isPending}
                      className="shrink-0 text-[11px] px-2 py-1 border border-blue-200 text-blue-600 rounded hover:bg-blue-50 disabled:opacity-40"
                    >
                      {copiedSaved === (c.key ?? c.name) ? '✅ 저장됨' : '+ 전략으로 저장'}
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">{c.desc}</p>
                  <div className="flex gap-3 mt-2 text-xs">
                    <span>3M {fmtRet(c.excess)} 초과</span>
                    <span>6M {c.excess6 != null ? fmtRet(c.excess6) : '—'} 초과</span>
                    <span className="text-gray-400">{c.count}종목 · 승률 {c.winRate}%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
