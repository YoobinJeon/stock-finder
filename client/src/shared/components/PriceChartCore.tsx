import { useEffect, useRef } from 'react';
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  ColorType,
  type IChartApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import { THEME_EVENT } from '../useTheme';

/** 캔들 차트 공용 렌더러 — CandleChart(자체 DB 시세)와 ETF 차트가 공유. */

export interface ChartRow {
  time: string; // 'YYYY-MM-DD'
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// 한국 관례: 상승 빨강 / 하락 파랑
const UP = '#ef4444';
const DOWN = '#3b82f6';

interface ChartTheme {
  background: string;
  textColor: string;
  gridColor: string;
  borderColor: string;
}

function getChartTheme(isDark: boolean): ChartTheme {
  return isDark
    ? { background: '#1f2937', textColor: '#9ca3af', gridColor: '#374151', borderColor: '#4b5563' }
    : { background: '#ffffff', textColor: '#6b7280', gridColor: '#f3f4f6', borderColor: '#e5e7eb' };
}

// 이동평균선 (단기 5·10 + 중장기 20·60·120).
// MA60은 중기 추세 기준선이라 굵게 그려 한눈에 구분되게 한다 (2026-08-01).
const MA_EMPHASIS_WIDTH = 3;
export const MA_LINES = [
  { period: 5,   color: '#ec4899', label: 'MA5',   width: 1 },                 // 분홍 (단기)
  { period: 10,  color: '#06b6d4', label: 'MA10',  width: 1 },                 // 청록 (단기)
  { period: 20,  color: '#f59e0b', label: 'MA20',  width: 1 },                 // 주황
  { period: 60,  color: '#10b981', label: 'MA60',  width: MA_EMPHASIS_WIDTH }, // 초록 (중기 기준선 — 강조)
  { period: 120, color: '#8b5cf6', label: 'MA120', width: 1 },                 // 보라
] as const;

export function calcMA(closes: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  let sum = 0;
  for (let i = 0; i < closes.length; i++) {
    sum += closes[i];
    if (i >= period) sum -= closes[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

interface Props {
  rows: ChartRow[];
  height: number;
  /** 미니 모드: 축·거래량·크로스헤어 숨기고 최근 구간만 표시 (차트보드용) */
  mini?: boolean;
  /** 미니 모드에서 표시할 최근 봉 수 (이평선은 전체 데이터로 계산) */
  visibleBars?: number;
}

export function PriceChartCore({ rows, height, mini = false, visibleBars = 60 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || rows.length === 0) return;

    const isDark = document.documentElement.classList.contains('dark');
    const chartTheme = getChartTheme(isDark);

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: chartTheme.background },
        textColor: chartTheme.textColor,
        fontSize: 11,
      },
      grid: {
        vertLines: { color: mini ? 'transparent' : chartTheme.gridColor },
        horzLines: { color: mini ? 'transparent' : chartTheme.gridColor },
      },
      rightPriceScale: { borderColor: chartTheme.borderColor, visible: !mini },
      timeScale: { borderColor: chartTheme.borderColor, visible: !mini },
      crosshair: mini
        ? { mode: 0, vertLine: { visible: false, labelVisible: false }, horzLine: { visible: false, labelVisible: false } }
        : { mode: 0 },
      handleScroll: !mini,
      handleScale: !mini,
      localization: {
        priceFormatter: (p: number) => p.toLocaleString('ko-KR'),
      },
    });

    chartRef.current = chart;

    const data = rows.map((r) => ({ ...r, time: r.time as unknown as UTCTimestamp }));

    const candles = chart.addSeries(CandlestickSeries, {
      upColor: UP,
      downColor: DOWN,
      borderUpColor: UP,
      borderDownColor: DOWN,
      wickUpColor: UP,
      wickDownColor: DOWN,
      priceLineVisible: !mini,
      lastValueVisible: !mini,
    });
    candles.setData(data.map(({ volume, ...c }) => c));

    // 이동평균선 5종 — 전체 데이터로 계산해 표시 구간에서도 정확
    const closes = data.map((r) => r.close);
    for (const { period, color, width } of MA_LINES) {
      if (data.length < period) continue;
      const ma = calcMA(closes, period);
      const line = chart.addSeries(LineSeries, {
        color,
        lineWidth: width,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      line.setData(
        data.flatMap((r, i) => (ma[i] != null ? [{ time: r.time, value: ma[i]! }] : [])),
      );
    }

    if (!mini) {
      const volumes = chart.addSeries(HistogramSeries, {
        priceScaleId: 'volume',
        priceFormat: { type: 'volume' },
        lastValueVisible: false,
        priceLineVisible: false,
      });
      chart.priceScale('volume').applyOptions({
        scaleMargins: { top: 0.82, bottom: 0 },
        visible: false,
      });
      volumes.setData(
        data.map((r, i) => ({
          time: r.time,
          value: r.volume,
          color: (i > 0 && r.close < data[i - 1].close ? DOWN : UP) + '55',
        })),
      );
      chart.timeScale().fitContent();
    } else {
      // 미니: 최근 구간만 보여주되 이평선은 앞선 데이터로 이미 계산됨
      const from = Math.max(0, data.length - visibleBars);
      chart.timeScale().setVisibleLogicalRange({ from, to: data.length - 1 });
    }

    return () => {
      chartRef.current = null;
      chart.remove();
    };
  }, [rows, height, mini, visibleBars]);

  // 다크모드 토글 시 실시간 색상 전환 (시리즈 색상은 유지)
  useEffect(() => {
    const onThemeChange = () => {
      const isDark = document.documentElement.classList.contains('dark');
      const chartTheme = getChartTheme(isDark);
      chartRef.current?.applyOptions({
        layout: {
          background: { type: ColorType.Solid, color: chartTheme.background },
          textColor: chartTheme.textColor,
        },
        grid: {
          vertLines: { color: mini ? 'transparent' : chartTheme.gridColor },
          horzLines: { color: mini ? 'transparent' : chartTheme.gridColor },
        },
        rightPriceScale: { borderColor: chartTheme.borderColor },
        timeScale: { borderColor: chartTheme.borderColor },
      });
    };

    window.addEventListener(THEME_EVENT, onThemeChange);
    return () => window.removeEventListener(THEME_EVENT, onThemeChange);
  }, [mini]);

  return <div ref={containerRef} style={{ height, width: '100%' }} />;
}
