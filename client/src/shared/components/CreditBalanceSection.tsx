import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { API } from '../api/endpoints';
import { fmtKrw, fmtShares } from '../../pages/compare/compareFormat';
import { SECTION_CLASS } from '../lib/panelSection';
import { CreditTrendChart } from './CreditTrendChart';

/** 신용잔고율 추이 차트 높이(px) — 1년치를 확대·축소하며 보기 충분한 크기 */
const TREND_CHART_HEIGHT = 180;

/** 신용잔고율(%)이 이 값 이상이면 주의 색상으로 강조 */
const CREDIT_RATIO_WARNING_THRESHOLD = 2;

/** API 응답의 추이 1행 — 차트용 CreditTrendPoint(date·ratio)와 이름이 겹치지 않게 Row로 둔다. */
interface CreditTrendRow {
  date: string;
  remainQty: number | null;
  remainAmt: number | null;
  remainRatio: number | null;
}

interface CreditBalanceLatest {
  /** 해당 거래일의 결제일(T+2). 잔고는 결제 확정분만 존재해 시세보다 2영업일 뒤처진다. */
  settlementDate?: string | null;
  remainQty: number | null;
  remainAmt: number | null;
  remainRatio: number | null;
  shareRatio: number | null;
  changeQty: number | null;
}

/** GET /stocks/:ticker/credit-balance 응답 */
interface CreditBalanceResponse {
  ticker: string;
  available: boolean;
  reason?: string;
  asOf?: string;
  latest?: CreditBalanceLatest;
  trend?: CreditTrendRow[];
}

/** 원본이 이미 %값(0.38 = 0.38%)인 필드용 — fmtPercent(소수 기준)와 달리 100을 곱하지 않는다. */
function fmtPct(v: number | null, digits = 2): string {
  return v == null ? '—' : `${v.toFixed(digits)}%`;
}


type CellEmphasis = 'none' | 'warn' | 'up' | 'down';

// 칸별 강조 스타일 — 지표 카드가 서로 구분되도록 테두리·배경을 함께 바꾼다
const CELL_STYLE: Record<CellEmphasis, { box: string; value: string }> = {
  none: { box: 'border-gray-200 bg-gray-50', value: 'text-gray-800' },
  warn: { box: 'border-amber-300 bg-amber-50', value: 'text-amber-700' },
  up: { box: 'border-red-200 bg-red-50/60', value: 'text-red-600' },
  down: { box: 'border-blue-200 bg-blue-50/60', value: 'text-blue-600' },
};

/** 전일대비 증감 방향 → 강조 색상 (신용잔고 증가=적색, 감소=청색 — 국내 시세 색 관례) */
function changeEmphasis(v: number | null): CellEmphasis {
  if (v == null || v === 0) return 'none';
  return v > 0 ? 'up' : 'down';
}

/** 지표 1칸 — 테두리·배경으로 칸 경계를 명확히 해 가독성을 높인다 */
function CreditCell({
  label,
  value,
  emphasis = 'none',
  hint,
}: {
  label: string;
  value: string;
  emphasis?: CellEmphasis;
  hint?: string;
}) {
  const style = CELL_STYLE[emphasis];
  return (
    <div className={`rounded-lg border px-3 py-2 ${style.box}`}>
      <p className="text-[11px] text-gray-500 whitespace-nowrap">{label}</p>
      <p className={`mt-0.5 text-sm font-bold tabular-nums whitespace-nowrap ${style.value}`}>{value}</p>
      {hint && <p className="text-[10px] text-amber-600 mt-0.5 whitespace-nowrap">{hint}</p>}
    </div>
  );
}

/**
 * 조회 중 자리표시자 — 실제 섹션과 같은 골격(제목 + 4칸 + 차트)을 회색 블록으로 둔다.
 * 높이를 맞춰야 데이터가 도착할 때 아래 섹션들이 밀리지 않는다(레이아웃 시프트 방지).
 */
function CreditBalanceSkeleton() {
  return (
    <div className={SECTION_CLASS} aria-busy="true" aria-live="polite">
      <h4 className="font-semibold text-gray-900 mb-4 text-sm">
        신용잔고
        <span className="ml-1.5 text-xs font-normal text-gray-400">불러오는 중…</span>
      </h4>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
            <div className="h-3 w-16 rounded bg-gray-200 animate-pulse" />
            <div className="mt-1.5 h-4 w-20 rounded bg-gray-200 animate-pulse" />
          </div>
        ))}
      </div>
      <div
        className="mt-2 rounded-lg border border-gray-200 bg-gray-50 animate-pulse"
        style={{ height: TREND_CHART_HEIGHT + 32 }}
      />
      <span className="sr-only">신용잔고를 불러오는 중입니다.</span>
    </div>
  );
}

/**
 * 종목 상세 — 신용잔고(신용거래융자) 섹션. KIS `[국내주식-110]` 온디맨드 조회 결과를 표시한다.
 * 데이터가 없으면(available:false) 섹션 자체를 숨긴다 — "없으면 기입하지 않음" 관례.
 */
export function CreditBalanceSection({ ticker }: { ticker: string }) {
  const { data, isLoading } = useQuery<CreditBalanceResponse>({
    queryKey: ['credit-balance', ticker],
    queryFn: () => apiClient.get(API.stocks.creditBalance(ticker)).then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });

  // 로딩 중에는 자리를 잡아둔다. 이전에는 아래 available 검사에 로딩 상태까지 걸려
  // 섹션이 통째로 없다가 조회가 끝나는 순간 튀어나왔다 — 3년치를 25페이지로 나눠
  // 받는 구조라 캐시가 비면 수 초가 걸리는데 그동안 화면에 아무 단서가 없었다.
  if (isLoading) return <CreditBalanceSkeleton />;

  if (!data?.available || !data.latest) return null;

  const { latest, trend = [] } = data;
  const isHighRatio = latest.remainRatio != null && latest.remainRatio >= CREDIT_RATIO_WARNING_THRESHOLD;
  // trend는 최신순(응답 관례) — 차트는 시간 흐름대로 그려야 자연스러워 뒤집는다.
  const chartPoints = trend
    .slice()
    .reverse()
    .filter((t): t is CreditTrendRow & { remainRatio: number } => t.remainRatio != null)
    .map((t) => ({ date: t.date, ratio: t.remainRatio }));

  return (
    <div className={SECTION_CLASS}>
      <h4 className="font-semibold text-gray-900 mb-4 text-sm">
        신용잔고
        {/* 원천 표기: 2026-07-26에 키움 ka10013 → KIS [국내주식-110]으로 전환했으나
            라벨이 "키움"으로 남아 있었다. 거래일 기준·대주 포함이 KIS 쪽 이점. */}
        <span className="ml-1.5 text-xs font-normal text-gray-400">
          KIS{data.asOf ? ` · 거래일 ${data.asOf}` : ''}{trend.length > 1 ? ` · 최근 ${trend.length}영업일` : ''}
        </span>
      </h4>
      {/* 날짜가 시세보다 뒤처지는 것은 결측이 아니라 정상이다 — 신용융자 잔고는 결제(T+2)
          시점에 확정돼 최신 2영업일치가 아직 존재하지 않는다(2026-07-26 실측 ⑪).
          이 안내가 없으면 "데이터가 밀렸다"는 오해로 이어진다. */}
      {latest.settlementDate && (
        <p className="-mt-3 mb-3 text-[11px] text-gray-400">
          결제일 {latest.settlementDate} 확정분 · 신용융자 잔고는 결제(T+2) 시점에 확정돼
          시세보다 2영업일 뒤의 값입니다
        </p>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <CreditCell
          label="신용잔고율"
          value={fmtPct(latest.remainRatio)}
          emphasis={isHighRatio ? 'warn' : 'none'}
          hint={isHighRatio ? `주의 (${CREDIT_RATIO_WARNING_THRESHOLD}%↑)` : undefined}
        />
        <CreditCell label="신용잔고 금액" value={fmtKrw(latest.remainAmt)} />
        <CreditCell
          label="전일대비"
          value={fmtShares(latest.changeQty)}
          emphasis={changeEmphasis(latest.changeQty)}
        />
        <CreditCell label="공여율" value={fmtPct(latest.shareRatio)} />
      </div>
      {chartPoints.length >= 2 && (
        <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50 px-3 pt-2 pb-2">
          <p className="text-[11px] text-gray-500 mb-1">
            신용잔고율 추이
            <span className="ml-1.5 text-[10px] text-gray-400">
              최근 {chartPoints.length}영업일 · 휠로 확대, 드래그로 이동
            </span>
          </p>
          <CreditTrendChart points={chartPoints} height={TREND_CHART_HEIGHT} />
        </div>
      )}
    </div>
  );
}
