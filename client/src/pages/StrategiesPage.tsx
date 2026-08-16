import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../shared/api/client';
import { API } from '../shared/api/endpoints';

export interface PresetCriteria {
  market?: string;
  minScore?: number;
  maxPer?: number;
  minOpMargin?: number;
  minRevenueGrowth?: number;
  minDivYield?: number;
  minMarketCap?: number; // 원
  // 분기 실적 개선 (스크리너 실적 개선 필터) — 'yoy' | 'qoq' | 'both'
  earningsTrend?: string;
  minEarningsGrowth?: number;
  minEarningsStreak?: number;
  estImproving?: boolean;
  // 수급
  foreignNetBuy5d?: boolean;
  instNetBuy5d?: boolean;
  minForeignStreak?: number;
  // 기술
  goldenCross?: boolean;
  aboveMa20?: boolean;
  earlyTrend?: boolean;
  maxPctFrom52wHigh?: number;
  rsiMin?: number;
  rsiMax?: number;
  minVolRatio?: number;
  // 추세 지표 확장 (MA150/200·52주 저점 대비·RS 백분위 — 거장 전략 정밀화)
  aboveMa150?: boolean;
  aboveMa200?: boolean;
  ma150AboveMa200?: boolean;
  ma200Up?: boolean;
  minPctFrom52wLow?: number;
  minRsPercentile?: number;
}

export interface Preset {
  id: string;
  name: string;
  description: string | null;
  criteria: PresetCriteria;
  is_builtin: boolean;
}

/** 실적 개선 모드 표기 (스크리너 필터·전략 요약 공용) */
export const EARNINGS_TREND_LABELS: Record<string, string> = {
  yoy: '전년동기 대비',
  qoq: '직전분기 대비',
  both: '전년동기·직전분기 모두',
};

/**
 * 모드 라벨 조회 — 자기 키만 본다. 평범한 객체 인덱싱은 'constructor'·'toString' 같은
 * 프로토타입 키에 값을 돌려주므로, 손으로 고친 프리셋 행이 화이트리스트를 통과할 수 있다.
 */
export function earningsTrendLabel(mode: unknown): string | null {
  return typeof mode === 'string' &&
    Object.prototype.hasOwnProperty.call(EARNINGS_TREND_LABELS, mode)
    ? EARNINGS_TREND_LABELS[mode]
    : null;
}

/** 조건을 사람이 읽는 요약으로 */
export function criteriaSummary(c: PresetCriteria): string[] {
  const parts: string[] = [];
  if (c.market) parts.push(`시장 ${c.market}`);
  if (c.minScore != null) parts.push(`종합 ${c.minScore}점+`);
  if (c.maxPer != null) parts.push(`tPER ≤ ${c.maxPer}배`);
  if (c.minOpMargin != null) parts.push(`영업이익률 ≥ ${c.minOpMargin}%`);
  if (c.minRevenueGrowth != null) parts.push(`매출성장 ≥ ${c.minRevenueGrowth}%`);
  if (c.minDivYield != null) parts.push(`배당 ≥ ${c.minDivYield}%`);
  if (c.minMarketCap != null) {
    const v = c.minMarketCap;
    parts.push(`시총 ≥ ${v >= 1e12 ? `${v / 1e12}조` : `${Math.round(v / 1e8).toLocaleString()}억`}`);
  }
  const trendLabel = earningsTrendLabel(c.earningsTrend);
  if (trendLabel) {
    const floor = c.minEarningsGrowth != null ? ` ${c.minEarningsGrowth}%+` : '';
    parts.push(`실적 개선 ${trendLabel}${floor}`);
  }
  if (c.minEarningsStreak != null) parts.push(`YoY ${c.minEarningsStreak}분기 연속 개선`);
  if (c.estImproving) parts.push('다음 분기 컨센서스 개선');
  if (c.foreignNetBuy5d) parts.push('외국인 5일 순매수');
  if (c.instNetBuy5d) parts.push('기관 5일 순매수');
  if (c.minForeignStreak != null) parts.push(`외국인 ${c.minForeignStreak}일 연속 순매수`);
  if (c.goldenCross) parts.push('골든크로스(MA20>MA60)');
  if (c.aboveMa20) parts.push('주가 > MA20');
  if (c.earlyTrend) parts.push('추세초기전환(MA5≥MA10·MA10우상향)');
  if (c.maxPctFrom52wHigh != null) parts.push(`52주 고점 -${c.maxPctFrom52wHigh}% 이내`);
  if (c.rsiMin != null || c.rsiMax != null) parts.push(`RSI ${c.rsiMin ?? 0}~${c.rsiMax ?? 100}`);
  if (c.minVolRatio != null) parts.push(`거래량 ≥ ${c.minVolRatio}배`);
  if (c.aboveMa150) parts.push('주가 > MA150');
  if (c.aboveMa200) parts.push('주가 > MA200');
  if (c.ma150AboveMa200) parts.push('MA150 > MA200');
  if (c.ma200Up) parts.push('MA200 우상향');
  if (c.minPctFrom52wLow != null) parts.push(`52주 저점 +${c.minPctFrom52wLow}% 이상`);
  if (c.minRsPercentile != null) parts.push(`RS 백분위 ≥ ${c.minRsPercentile}`);
  return parts;
}

interface FormState {
  id: string | null;
  name: string;
  description: string;
  market: string;
  minScore: string;
  maxPer: string;
  minOpMargin: string;
  minRevenueGrowth: string;
  minDivYield: string;
  minMarketCapEok: string; // 억 단위 입력
  earningsTrend: string;
  minEarningsGrowth: string;
  minEarningsStreak: string;
  estImproving: boolean;
  foreignNetBuy5d: boolean;
  instNetBuy5d: boolean;
  minForeignStreak: string;
  goldenCross: boolean;
  aboveMa20: boolean;
  earlyTrend: boolean;
  maxPctFrom52wHigh: string;
  rsiMin: string;
  rsiMax: string;
  minVolRatio: string;
  aboveMa150: boolean;
  aboveMa200: boolean;
  ma150AboveMa200: boolean;
  ma200Up: boolean;
  minPctFrom52wLow: string;
  minRsPercentile: string;
}

const EMPTY_FORM: FormState = {
  id: null, name: '', description: '', market: '',
  minScore: '', maxPer: '', minOpMargin: '', minRevenueGrowth: '', minDivYield: '', minMarketCapEok: '',
  earningsTrend: '', minEarningsGrowth: '', minEarningsStreak: '', estImproving: false,
  foreignNetBuy5d: false, instNetBuy5d: false, minForeignStreak: '',
  goldenCross: false, aboveMa20: false, earlyTrend: false, maxPctFrom52wHigh: '', rsiMin: '', rsiMax: '', minVolRatio: '',
  aboveMa150: false, aboveMa200: false, ma150AboveMa200: false, ma200Up: false,
  minPctFrom52wLow: '', minRsPercentile: '',
};

function toCriteria(f: FormState): PresetCriteria {
  const num = (s: string) => (s.trim() === '' ? undefined : Number(s));
  return {
    market: f.market || undefined,
    minScore: num(f.minScore),
    maxPer: num(f.maxPer),
    minOpMargin: num(f.minOpMargin),
    minRevenueGrowth: num(f.minRevenueGrowth),
    minDivYield: num(f.minDivYield),
    minMarketCap: f.minMarketCapEok.trim() === '' ? undefined : Number(f.minMarketCapEok) * 1e8,
    earningsTrend: f.earningsTrend || undefined,
    // 임계값은 모드를 골랐을 때만 의미가 있다
    minEarningsGrowth: f.earningsTrend ? num(f.minEarningsGrowth) : undefined,
    minEarningsStreak: num(f.minEarningsStreak),
    estImproving: f.estImproving || undefined,
    foreignNetBuy5d: f.foreignNetBuy5d || undefined,
    instNetBuy5d: f.instNetBuy5d || undefined,
    minForeignStreak: num(f.minForeignStreak),
    goldenCross: f.goldenCross || undefined,
    aboveMa20: f.aboveMa20 || undefined,
    earlyTrend: f.earlyTrend || undefined,
    maxPctFrom52wHigh: num(f.maxPctFrom52wHigh),
    rsiMin: num(f.rsiMin),
    rsiMax: num(f.rsiMax),
    minVolRatio: num(f.minVolRatio),
    aboveMa150: f.aboveMa150 || undefined,
    aboveMa200: f.aboveMa200 || undefined,
    ma150AboveMa200: f.ma150AboveMa200 || undefined,
    ma200Up: f.ma200Up || undefined,
    minPctFrom52wLow: num(f.minPctFrom52wLow),
    minRsPercentile: num(f.minRsPercentile),
  };
}

function toForm(p: Preset): FormState {
  const c = p.criteria ?? {};
  const s = (v: number | undefined) => (v != null ? String(v) : '');
  return {
    id: p.id,
    name: p.name,
    description: p.description ?? '',
    market: c.market ?? '',
    minScore: s(c.minScore),
    maxPer: s(c.maxPer),
    minOpMargin: s(c.minOpMargin),
    minRevenueGrowth: s(c.minRevenueGrowth),
    minDivYield: s(c.minDivYield),
    minMarketCapEok: c.minMarketCap != null ? String(c.minMarketCap / 1e8) : '',
    earningsTrend: earningsTrendLabel(c.earningsTrend) ? String(c.earningsTrend) : '',
    minEarningsGrowth: s(c.minEarningsGrowth),
    minEarningsStreak: s(c.minEarningsStreak),
    estImproving: c.estImproving === true,
    foreignNetBuy5d: c.foreignNetBuy5d === true,
    instNetBuy5d: c.instNetBuy5d === true,
    minForeignStreak: s(c.minForeignStreak),
    goldenCross: c.goldenCross === true,
    aboveMa20: c.aboveMa20 === true,
    earlyTrend: c.earlyTrend === true,
    maxPctFrom52wHigh: s(c.maxPctFrom52wHigh),
    rsiMin: s(c.rsiMin),
    rsiMax: s(c.rsiMax),
    minVolRatio: s(c.minVolRatio),
    aboveMa150: c.aboveMa150 === true,
    aboveMa200: c.aboveMa200 === true,
    ma150AboveMa200: c.ma150AboveMa200 === true,
    ma200Up: c.ma200Up === true,
    minPctFrom52wLow: s(c.minPctFrom52wLow),
    minRsPercentile: s(c.minRsPercentile),
  };
}

interface AlgorithmConfig {
  id: string;
  name: string;
  category: string;
  description: string;
  enabled: boolean;
  weight: number; // 0~1
}

/** 5팩터 점수 엔진의 가중치·활성화를 DB 설정으로 조정 (배포 없이 반영) */
function AlgorithmWeightsCard() {
  const qc = useQueryClient();
  const { data: algorithms = [] } = useQuery<AlgorithmConfig[]>({
    queryKey: ['algorithms'],
    queryFn: () => apiClient.get(API.algorithms.list).then((r) => r.data),
  });

  // 로컬 편집 상태: id → { enabled, weightPct(문자열) }
  const [edits, setEdits] = useState<Record<string, { enabled: boolean; weightPct: string }>>({});
  useEffect(() => {
    if (algorithms.length > 0) {
      setEdits(Object.fromEntries(algorithms.map((a) => [
        a.id, { enabled: a.enabled, weightPct: String(Math.round(a.weight * 100)) },
      ])));
    }
  }, [algorithms]);

  const save = useMutation({
    mutationFn: async () => {
      for (const a of algorithms) {
        const e = edits[a.id];
        if (!e) continue;
        const weight = Number(e.weightPct) / 100;
        if (e.enabled !== a.enabled || Math.abs(weight - a.weight) > 0.0001) {
          await apiClient.put(API.algorithms.update(a.id), { enabled: e.enabled, weight });
        }
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['algorithms'] }),
  });

  const rescore = useMutation({
    mutationFn: () => apiClient.post(API.data.refresh, { scope: 'rescore' }),
  });

  const totalPct = algorithms.reduce((sum, a) => {
    const e = edits[a.id];
    return sum + (e?.enabled ? Number(e.weightPct) || 0 : 0);
  }, 0);
  const invalidWeight = algorithms.some((a) => {
    const w = Number(edits[a.id]?.weightPct);
    return Number.isNaN(w) || w < 0 || w > 100;
  });

  return (
    <div className="bg-surface rounded-xl border border-gray-200 p-5 mt-6">
      <h3 className="font-semibold text-gray-900 mb-1">점수 알고리즘 가중치</h3>
      <p className="text-xs text-gray-500 mb-4">
        5팩터 종합점수의 팩터별 비중을 조정합니다. 가중치는 활성 팩터끼리 자동 정규화되므로
        합이 100%가 아니어도 비율대로 반영됩니다. 저장 후 <b>재채점</b>을 실행해야 점수에 적용됩니다.
      </p>
      <div className="flex flex-col gap-2">
        {algorithms.map((a) => {
          const e = edits[a.id] ?? { enabled: a.enabled, weightPct: String(Math.round(a.weight * 100)) };
          return (
            <div key={a.id} className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${e.enabled ? 'border-gray-200' : 'border-gray-100 bg-gray-50 opacity-60'}`}>
              <input
                type="checkbox"
                checked={e.enabled}
                onChange={(ev) => setEdits((prev) => ({ ...prev, [a.id]: { ...e, enabled: ev.target.checked } }))}
                className="accent-blue-600"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900">{a.name}</p>
                <p className="text-[11px] text-gray-400 truncate">{a.description}</p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={e.weightPct}
                  disabled={!e.enabled}
                  onChange={(ev) => setEdits((prev) => ({ ...prev, [a.id]: { ...e, weightPct: ev.target.value } }))}
                  className="w-16 border border-gray-300 rounded-lg px-2 py-1 text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                />
                <span className="text-xs text-gray-400">%</span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-3 mt-4">
        <button
          onClick={() => save.mutate()}
          disabled={save.isPending || invalidWeight || algorithms.length === 0}
          className="px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-40"
        >
          {save.isPending ? '저장 중…' : '가중치 저장'}
        </button>
        <button
          onClick={() => rescore.mutate()}
          disabled={rescore.isPending}
          className="px-4 py-2 text-sm text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50 disabled:opacity-40"
        >
          재채점 실행 (1~2분)
        </button>
        <span className={`text-xs ${totalPct === 100 ? 'text-gray-400' : 'text-amber-600'}`}>
          활성 가중치 합 {totalPct}%{totalPct !== 100 && ' — 비율대로 자동 정규화됨'}
        </span>
        {save.isSuccess && !save.isPending && <span className="text-xs text-green-600">저장됨</span>}
        {rescore.isSuccess && <span className="text-xs text-green-600">재채점 시작됨 — 데이터 페이지에서 진행 상황 확인</span>}
        {rescore.isError && <span className="text-xs text-red-500">재채점 실패 — 이미 실행 중인 작업이 있는지 확인하세요</span>}
      </div>
    </div>
  );
}

function CheckField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-blue-600" />
      {label}
    </label>
  );
}

function NumField({ label, hint, value, onChange }: {
  label: string; hint?: string; value: string; onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="block text-xs text-gray-500 mb-1">
        {label}{hint && <span className="text-gray-300 ml-1">{hint}</span>}
      </label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="—"
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </div>
  );
}

export function StrategiesPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  const { data: presets = [] } = useQuery<Preset[]>({
    queryKey: ['screener', 'presets'],
    queryFn: () => apiClient.get(API.screener.presets).then((r) => r.data),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['screener', 'presets'] });

  const save = useMutation({
    mutationFn: () => {
      const body = { name: form.name, description: form.description || null, criteria: toCriteria(form) };
      return form.id
        ? apiClient.put(API.screener.preset(form.id), body)
        : apiClient.post(API.screener.presets, body);
    },
    onSuccess: () => { invalidate(); setForm(EMPTY_FORM); },
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiClient.delete(API.screener.preset(id)),
    onSuccess: () => { invalidate(); if (form.id) setForm(EMPTY_FORM); },
  });

  return (
    <div className="p-6 max-w-5xl">
      <h2 className="text-xl font-bold text-gray-900 mb-1">전략 관리</h2>
      <p className="text-sm text-gray-500 mb-6">
        재무 조건 기반 스크리닝 전략을 만들고 관리합니다. 전략은 스크리너 상단 칩으로 나타나며,
        클릭하면 해당 조건으로 즉시 필터링됩니다.
      </p>

      <div className="grid md:grid-cols-2 gap-6">
        {/* 전략 목록 */}
        <div className="flex flex-col gap-3">
          {presets.map((p) => (
            <div key={p.id} className={`bg-surface rounded-xl border p-4 ${form.id === p.id ? 'border-blue-400' : 'border-gray-200'}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-gray-900">
                    {p.name}
                    {p.is_builtin && <span className="ml-2 text-[10px] font-normal text-gray-400 border border-gray-200 rounded px-1.5 py-0.5">기본</span>}
                  </p>
                  {p.description && <p className="text-xs text-gray-500 mt-0.5">{p.description}</p>}
                </div>
                <div className="flex gap-1 shrink-0">
                  <button
                    onClick={() => navigate('/screener', { state: { presetId: p.id } })}
                    className="text-xs px-2 py-1 rounded border border-blue-200 text-blue-600 hover:bg-blue-50"
                  >
                    적용
                  </button>
                  <button
                    onClick={() => setForm(toForm(p))}
                    className="text-xs px-2 py-1 rounded border border-gray-200 text-gray-600 hover:bg-gray-50"
                  >
                    수정
                  </button>
                  <button
                    onClick={() => { if (confirm(`'${p.name}' 전략을 삭제할까요?`)) remove.mutate(p.id); }}
                    className="text-xs px-2 py-1 rounded border border-gray-200 text-gray-400 hover:text-red-500 hover:border-red-200"
                  >
                    삭제
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {criteriaSummary(p.criteria ?? {}).map((s) => (
                  <span key={s} className="text-[11px] bg-gray-50 border border-gray-100 text-gray-600 rounded px-1.5 py-0.5">{s}</span>
                ))}
                {criteriaSummary(p.criteria ?? {}).length === 0 && (
                  <span className="text-[11px] text-gray-300">조건 없음 (전체)</span>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* 추가/수정 폼 */}
        <div className="bg-surface rounded-xl border border-gray-200 p-5 h-fit">
          <h3 className="font-semibold text-gray-900 mb-4">{form.id ? '전략 수정' : '새 전략 추가'}</h3>
          <div className="flex flex-col gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">이름 *</label>
              <input
                value={form.name}
                onChange={(e) => set({ name: e.target.value })}
                placeholder="예: 저평가 배당 성장주"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">설명</label>
              <input
                value={form.description}
                onChange={(e) => set({ description: e.target.value })}
                placeholder="전략 의도를 메모하세요"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">시장</label>
                <select
                  value={form.market}
                  onChange={(e) => set({ market: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">전체</option>
                  <option value="KOSPI">KOSPI</option>
                  <option value="KOSDAQ">KOSDAQ</option>
                </select>
              </div>
              <NumField label="최소 종합점수" hint="0~100" value={form.minScore} onChange={(v) => set({ minScore: v })} />
              <NumField label="tPER 상한" hint="배" value={form.maxPer} onChange={(v) => set({ maxPer: v })} />
              <NumField label="최소 영업이익률" hint="%" value={form.minOpMargin} onChange={(v) => set({ minOpMargin: v })} />
              <NumField label="최소 매출성장률" hint="% YoY" value={form.minRevenueGrowth} onChange={(v) => set({ minRevenueGrowth: v })} />
              <NumField label="최소 배당수익률" hint="%" value={form.minDivYield} onChange={(v) => set({ minDivYield: v })} />
              <NumField label="최소 시가총액" hint="억 원" value={form.minMarketCapEok} onChange={(v) => set({ minMarketCapEok: v })} />
              <div>
                <label className="block text-xs text-gray-500 mb-1">실적 개선</label>
                <select
                  value={form.earningsTrend}
                  onChange={(e) => set({ earningsTrend: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">안 봄</option>
                  {Object.entries(EARNINGS_TREND_LABELS).map(([v, label]) => (
                    <option key={v} value={v}>{label}</option>
                  ))}
                </select>
              </div>
              <NumField
                label="실적 최소 증가율"
                hint="% · 비우면 0% 초과"
                value={form.minEarningsGrowth}
                onChange={(v) => set({ minEarningsGrowth: v })}
              />
              <NumField
                label="YoY 연속 개선"
                hint="분기 이상"
                value={form.minEarningsStreak}
                onChange={(v) => set({ minEarningsStreak: v })}
              />
              <CheckField
                label="다음 분기 컨센서스 개선"
                checked={form.estImproving}
                onChange={(v) => set({ estImproving: v })}
              />
            </div>

            <p className="text-xs font-medium text-gray-700 mt-2">수급 조건 <span className="text-gray-300 font-normal">(투자자별 매매동향 기준)</span></p>
            <div className="grid grid-cols-2 gap-2">
              <CheckField label="외국인 5일 순매수" checked={form.foreignNetBuy5d} onChange={(v) => set({ foreignNetBuy5d: v })} />
              <CheckField label="기관 5일 순매수" checked={form.instNetBuy5d} onChange={(v) => set({ instNetBuy5d: v })} />
              <NumField label="외국인 연속 순매수" hint="일 이상" value={form.minForeignStreak} onChange={(v) => set({ minForeignStreak: v })} />
            </div>

            <p className="text-xs font-medium text-gray-700 mt-2">기술적 조건 <span className="text-gray-300 font-normal">(일봉 기준)</span></p>
            <div className="grid grid-cols-2 gap-2">
              <CheckField label="골든크로스 (MA20>MA60)" checked={form.goldenCross} onChange={(v) => set({ goldenCross: v })} />
              <CheckField label="주가 > 20일선" checked={form.aboveMa20} onChange={(v) => set({ aboveMa20: v })} />
              <CheckField label="추세초기전환 (MA5≥MA10·MA10↑)" checked={form.earlyTrend} onChange={(v) => set({ earlyTrend: v })} />
              <NumField label="52주 고점 이내" hint="-% 이내" value={form.maxPctFrom52wHigh} onChange={(v) => set({ maxPctFrom52wHigh: v })} />
              <NumField label="최소 거래량 배율" hint="5일/20일 평균" value={form.minVolRatio} onChange={(v) => set({ minVolRatio: v })} />
              <NumField label="RSI 최소" hint="0~100" value={form.rsiMin} onChange={(v) => set({ rsiMin: v })} />
              <NumField label="RSI 최대" hint="0~100" value={form.rsiMax} onChange={(v) => set({ rsiMax: v })} />
            </div>

            <p className="text-xs font-medium text-gray-700 mt-2">추세 지표 확장 <span className="text-gray-300 font-normal">(MA150/200·52주 저점·RS 백분위)</span></p>
            <div className="grid grid-cols-2 gap-2">
              <CheckField label="주가 > MA150" checked={form.aboveMa150} onChange={(v) => set({ aboveMa150: v })} />
              <CheckField label="주가 > MA200" checked={form.aboveMa200} onChange={(v) => set({ aboveMa200: v })} />
              <CheckField label="MA150 > MA200" checked={form.ma150AboveMa200} onChange={(v) => set({ ma150AboveMa200: v })} />
              <CheckField label="MA200 우상향" checked={form.ma200Up} onChange={(v) => set({ ma200Up: v })} />
              <NumField label="52주 저점 대비" hint="+% 이상" value={form.minPctFrom52wLow} onChange={(v) => set({ minPctFrom52wLow: v })} />
              <NumField label="RS 백분위 최소" hint="0~100" value={form.minRsPercentile} onChange={(v) => set({ minRsPercentile: v })} />
            </div>
            <div className="flex gap-2 mt-2">
              <button
                onClick={() => save.mutate()}
                disabled={!form.name.trim() || save.isPending}
                className="px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-40"
              >
                {form.id ? '저장' : '추가'}
              </button>
              {form.id && (
                <button
                  onClick={() => setForm(EMPTY_FORM)}
                  className="px-4 py-2 text-sm text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50"
                >
                  새로 만들기
                </button>
              )}
            </div>
            <p className="text-xs text-gray-400 mt-1">
              재무 조건은 네이버 최신 확정 연간 실적 기준입니다. 비워둔 조건은 적용되지 않습니다.
            </p>
          </div>
        </div>
      </div>

      <AlgorithmWeightsCard />
    </div>
  );
}
