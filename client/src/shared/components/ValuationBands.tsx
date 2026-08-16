import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { API } from '../api/endpoints';
import { fmtRatio, fmtPercent, toNum } from '../../pages/compare/compareFormat';
import { ValuationBandChart, BAND_COLORS, type BandLine } from './ValuationBandChart';
import { SECTION_CLASS } from '../lib/panelSection';

/**
 * 종목 상세 — PER 밴드 / PBR 밴드 / PBR-ROE 밴드 섹션. GET /stocks/:ticker/valuation-bands
 * 응답을 그대로 그린다(계산은 서버 valuationBands.ts). 데이터가 없으면(available:false)
 * 섹션 자체를 숨긴다 — "없으면 기입하지 않음" 관례(CreditBalanceSection과 동일).
 */

const CHART_HEIGHT = 280;
const SCATTER_WIDTH = 400;
const SCATTER_HEIGHT = 240;
const SCATTER_PAD = 40;
// 산점도 도메인에 여유를 두기 위한 패딩 비율(점이 축 경계에 딱 붙지 않도록)
const DOMAIN_PADDING_RATIO = 0.15;

type TabKey = 'per' | 'pbr' | 'pbrRoe';

interface BandMultiplePoint { date: string; value: number }
interface BandSeriesResponse { label: string; multiple: number; series: BandMultiplePoint[] }
interface PbrRoePointResponse { fiscalYear: number; roe: number; pbr: number; isEstimate: boolean }
interface RegressionLine { slope: number; intercept: number }

interface ValuationBandsResponse {
  available: boolean;
  reason?: string;
  price?: { date: string; close: number }[];
  perBands?: BandSeriesResponse[];
  pbrBands?: BandSeriesResponse[];
  pbrRoe?: { points: PbrRoePointResponse[]; fitLine: RegressionLine | null };
  current?: { per: number | null; pbr: number | null; roe: number | null };
}

const TABS: { key: TabKey; label: string }[] = [
  { key: 'per', label: 'PER 밴드' },
  { key: 'pbr', label: 'PBR 밴드' },
  { key: 'pbrRoe', label: 'PBR-ROE' },
];


/** 밴드선의 최신 시점 값(= 그 배수에 해당하는 주가 수준). 시계열이 비면 null. */
function lastBandValue(band: BandSeriesResponse): number | null {
  return band.series.length > 0 ? band.series[band.series.length - 1].value : null;
}

/** 주당 금액은 억/조 단위(fmtKrw)로 줄이면 의미가 사라지므로 원 단위 그대로 표기한다. */
function fmtWon(v: number | null): string {
  return v == null ? '—' : `${Math.round(v).toLocaleString('ko-KR')}원`;
}

function BandTab({
  price, bands, current, unit,
}: {
  price: { date: string; close: number }[];
  bands: BandSeriesResponse[];
  current: number | null;
  unit: 'PER' | 'PBR';
}) {
  const bandLines: BandLine[] = bands.map((b) => ({ label: b.label, multiple: b.multiple, series: b.series }));

  // 밴드 최저~최고 배수 범위 — 백분위 기호(P10·P90) 대신 실제 배수로만 안내한다
  const sorted = [...bands].sort((a, b) => a.multiple - b.multiple);
  const bandRange = sorted.length > 0
    ? `${fmtRatio(sorted[0].multiple)}~${fmtRatio(sorted[sorted.length - 1].multiple)}배`
    : null;

  return (
    <div>
      {current != null && (
        <div className="mb-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
          <p className="text-xs text-gray-600">
            현재 {unit} <span className="font-bold text-gray-900 text-sm">{fmtRatio(current)}배</span>
            {bandRange && <span className="text-gray-500"> · 밴드 {bandRange}</span>}
          </p>
          <p className="text-[10px] text-gray-400 mt-0.5">
            연간 확정 {unit === 'PER' ? 'EPS' : 'BPS'} 기준 · 네이버는 최근 4개 분기 연환산(TTM)
            기준이라 값이 다를 수 있습니다
          </p>
        </div>
      )}
      <ValuationBandChart price={price} bands={bandLines} height={CHART_HEIGHT} />
      {bands.length > 0 && (
        <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
          <p className="text-[10px] text-gray-400 mb-1.5">
            밴드별 주가 수준 (실선=주가, 점선=밴드 · 금액은 최신 시점 기준)
          </p>
          <div className="flex flex-col gap-1">
            {/* 배수만으로는 "얼마인지"를 알 수 없어 밴드선의 최신 주가 수준(원)을 함께 보여준다.
                위→아래가 고배수→저배수가 되도록 역순으로 나열해 차트의 선 순서와 일치시킨다. */}
            {bands.map((b, i) => ({ band: b, idx: i })).reverse().map(({ band, idx }) => (
              <div
                key={band.label}
                className="flex items-center justify-between gap-2 text-[11px] text-gray-600 px-1.5 py-0.5"
              >
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                  <span
                    className="inline-block w-3 h-0.5 rounded-full shrink-0"
                    style={{ backgroundColor: BAND_COLORS[idx % BAND_COLORS.length] }}
                    aria-hidden="true"
                  />
                  {fmtRatio(band.multiple)}배
                </span>
                <span className="tabular-nums whitespace-nowrap">{fmtWon(lastBandValue(band))}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PbrRoeScatter({ points, fitLine }: { points: PbrRoePointResponse[]; fitLine: RegressionLine | null }) {
  if (points.length === 0) {
    return <p className="text-xs text-gray-400 py-6 text-center">PBR-ROE 데이터가 없습니다.</p>;
  }

  const roes = points.map((p) => p.roe);
  const pbrs = points.map((p) => p.pbr);
  const roeRange = Math.max(...roes) - Math.min(...roes) || 1;
  const pbrRange = Math.max(...pbrs) - Math.min(...pbrs) || 1;
  const xMin = Math.min(...roes) - roeRange * DOMAIN_PADDING_RATIO;
  const xMax = Math.max(...roes) + roeRange * DOMAIN_PADDING_RATIO;
  const yMin = Math.min(0, Math.min(...pbrs) - pbrRange * DOMAIN_PADDING_RATIO);
  const yMax = Math.max(...pbrs) + pbrRange * DOMAIN_PADDING_RATIO;

  const sx = (roe: number) => SCATTER_PAD + ((roe - xMin) / (xMax - xMin)) * (SCATTER_WIDTH - 2 * SCATTER_PAD);
  const sy = (pbr: number) => SCATTER_HEIGHT - SCATTER_PAD - ((pbr - yMin) / (yMax - yMin)) * (SCATTER_HEIGHT - 2 * SCATTER_PAD);

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${SCATTER_WIDTH} ${SCATTER_HEIGHT}`}
        className="w-full max-w-md mx-auto"
        role="img"
        aria-label="PBR-ROE 산점도"
      >
        {/* 축 */}
        <line x1={SCATTER_PAD} y1={SCATTER_HEIGHT - SCATTER_PAD} x2={SCATTER_WIDTH - SCATTER_PAD} y2={SCATTER_HEIGHT - SCATTER_PAD} stroke="#e5e7eb" strokeWidth={1} />
        <line x1={SCATTER_PAD} y1={SCATTER_PAD} x2={SCATTER_PAD} y2={SCATTER_HEIGHT - SCATTER_PAD} stroke="#e5e7eb" strokeWidth={1} />
        <text x={SCATTER_PAD} y={SCATTER_HEIGHT - SCATTER_PAD + 14} fontSize={9} fill="#9ca3af">{fmtPercent(xMin)}</text>
        <text x={SCATTER_WIDTH - SCATTER_PAD} y={SCATTER_HEIGHT - SCATTER_PAD + 14} fontSize={9} fill="#9ca3af" textAnchor="end">{fmtPercent(xMax)}</text>
        <text x={SCATTER_PAD - 6} y={SCATTER_PAD} fontSize={9} fill="#9ca3af" textAnchor="end">{fmtRatio(yMax)}</text>
        <text x={SCATTER_PAD - 6} y={SCATTER_HEIGHT - SCATTER_PAD} fontSize={9} fill="#9ca3af" textAnchor="end">{fmtRatio(yMin)}</text>

        {/* 회귀선(적정 PBR = a×ROE + b) */}
        {fitLine && (
          <line
            x1={sx(xMin)} y1={sy(fitLine.slope * xMin + fitLine.intercept)}
            x2={sx(xMax)} y2={sy(fitLine.slope * xMax + fitLine.intercept)}
            stroke="#9ca3af" strokeWidth={1} strokeDasharray="4 3"
          />
        )}

        {/* 점 — 확정연도(파랑) vs 추정연도(주황) */}
        {points.map((p) => (
          <g key={p.fiscalYear}>
            <circle cx={sx(p.roe)} cy={sy(p.pbr)} r={4} fill={p.isEstimate ? '#f59e0b' : '#3b82f6'} />
            <text x={sx(p.roe) + 6} y={sy(p.pbr) - 6} fontSize={9} fill="#6b7280">
              {p.fiscalYear}{p.isEstimate ? 'E' : ''}
            </text>
          </g>
        ))}
      </svg>
      <p className="text-[11px] text-gray-400 text-center mt-1">
        X: ROE · Y: PBR
        <span className="ml-2 text-blue-500">● 확정</span>
        <span className="ml-1 text-amber-500">● 추정</span>
        {fitLine && <span className="ml-2">− − 회귀선</span>}
      </p>
    </div>
  );
}

export function ValuationBands({ ticker }: { ticker: string }) {
  const [tab, setTab] = useState<TabKey>('per');

  const { data } = useQuery<ValuationBandsResponse>({
    queryKey: ['valuation-bands', ticker],
    queryFn: () => apiClient.get(API.stocks.valuationBands(ticker)).then((r) => r.data),
    staleTime: 60 * 60 * 1000, // 서버 6시간 캐시와 별개로 클라이언트도 1시간 유지
  });

  if (!data?.available) return null;

  const price = data.price ?? [];
  const perBands = data.perBands ?? [];
  const pbrBands = data.pbrBands ?? [];
  const pbrRoePoints = data.pbrRoe?.points ?? [];
  // 밴드(가격×EPS/BPS)는 가격 시계열이 있어야 의미가 있고, 산점도는 가격과 무관하게 재무만
  // 있으면 그릴 수 있다 — 둘 중 하나라도 그릴 게 있으면 섹션을 보여준다.
  const hasBandData = price.length > 0 && (perBands.length > 0 || pbrBands.length > 0);
  const hasAnyData = hasBandData || pbrRoePoints.length > 0;
  if (!hasAnyData) return null;

  return (
    <div className={SECTION_CLASS}>
      <h4 className="font-semibold text-gray-900 mb-3 text-sm">
        밸류에이션 밴드
        <span className="ml-1.5 text-xs font-normal text-gray-400">최근 5년 · 과거 분포 분위수 기준</span>
      </h4>
      <div className="flex gap-1 mb-3">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`text-xs font-medium px-3 py-1.5 rounded-full transition-colors ${
              // 다크 모드에서 gray-900이 밝은 색으로 반전돼 흰 글씨가 묻히므로
              // 코드베이스 공통 선택 색상(blue-600 + 흰 글씨)을 쓴다
              tab === t.key
                ? 'bg-blue-600 text-white shadow-sm'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'per' && perBands.length > 0 && price.length > 0 && (
        <BandTab price={price} bands={perBands} current={toNum(data.current?.per ?? null)} unit="PER" />
      )}
      {tab === 'per' && (perBands.length === 0 || price.length === 0) && (
        <p className="text-xs text-gray-400 py-6 text-center">PER 밴드 데이터가 없습니다.</p>
      )}

      {tab === 'pbr' && pbrBands.length > 0 && price.length > 0 && (
        <BandTab price={price} bands={pbrBands} current={toNum(data.current?.pbr ?? null)} unit="PBR" />
      )}
      {tab === 'pbr' && (pbrBands.length === 0 || price.length === 0) && (
        <p className="text-xs text-gray-400 py-6 text-center">PBR 밴드 데이터가 없습니다.</p>
      )}

      {tab === 'pbrRoe' && (
        <PbrRoeScatter points={pbrRoePoints} fitLine={data.pbrRoe?.fitLine ?? null} />
      )}
    </div>
  );
}
