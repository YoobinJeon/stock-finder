import { useEffect, useRef } from 'react';
import {
  createChart,
  AreaSeries,
  ColorType,
  type IChartApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import { THEME_EVENT } from '../useTheme';

/**
 * 신용잔고율 추이 차트(약 1년치). 직접 그린 SVG는 확대·축소가 안 돼 긴 시계열을 보기 어려워
 * lightweight-charts로 교체했다(휠 확대·드래그 이동 기본 제공). 캔들·거래량이 없는 단일
 * 영역 차트라 PriceChartCore와 분리한다.
 */

export interface CreditTrendPoint {
  date: string;  // YYYY-MM-DD
  ratio: number; // 신용잔고율(%) — 원본이 이미 % 값
}

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

const LINE_COLOR = '#3b82f6';
const AREA_TOP = 'rgba(59, 130, 246, 0.28)';
const AREA_BOTTOM = 'rgba(59, 130, 246, 0.02)';
// 잔고율은 0.38%처럼 소수 둘째 자리가 의미 있는 값이라 자릿수를 고정한다
const RATIO_PRECISION = 2;

export function CreditTrendChart({ points, height }: { points: CreditTrendPoint[]; height: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || points.length < 2) return;

    const isDark = document.documentElement.classList.contains('dark');
    const theme = getChartTheme(isDark);

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: theme.background },
        textColor: theme.textColor,
        fontSize: 11,
      },
      grid: { vertLines: { color: theme.gridColor }, horzLines: { color: theme.gridColor } },
      rightPriceScale: { borderColor: theme.borderColor },
      timeScale: { borderColor: theme.borderColor, timeVisible: false },
      localization: { priceFormatter: (p: number) => `${p.toFixed(RATIO_PRECISION)}%` },
    });
    chartRef.current = chart;

    const series = chart.addSeries(AreaSeries, {
      lineColor: LINE_COLOR,
      topColor: AREA_TOP,
      bottomColor: AREA_BOTTOM,
      lineWidth: 2,
      priceLineVisible: false,
      priceFormat: { type: 'price', precision: RATIO_PRECISION, minMove: 0.01 },
    });
    series.setData(
      points.map((p) => ({ time: p.date as unknown as UTCTimestamp, value: p.ratio })),
    );

    chart.timeScale().fitContent();

    return () => {
      chartRef.current = null;
      chart.remove();
    };
  }, [points, height]);

  useEffect(() => {
    const onThemeChange = () => {
      const isDark = document.documentElement.classList.contains('dark');
      const theme = getChartTheme(isDark);
      chartRef.current?.applyOptions({
        layout: { background: { type: ColorType.Solid, color: theme.background }, textColor: theme.textColor },
        grid: { vertLines: { color: theme.gridColor }, horzLines: { color: theme.gridColor } },
        rightPriceScale: { borderColor: theme.borderColor },
        timeScale: { borderColor: theme.borderColor },
      });
    };
    window.addEventListener(THEME_EVENT, onThemeChange);
    return () => window.removeEventListener(THEME_EVENT, onThemeChange);
  }, []);

  if (points.length < 2) return null;
  return <div ref={containerRef} style={{ height, width: '100%' }} />;
}
