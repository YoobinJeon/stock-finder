import { useEffect, useRef } from 'react';
import {
  createChart,
  LineSeries,
  ColorType,
  LineStyle,
  type IChartApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import { THEME_EVENT } from '../useTheme';

/**
 * PER 밴드·PBR 밴드 공용 차트 — 주가 1선(굵게) + 밴드 최대 5선(연한 색). PriceChartCore와
 * 달리 캔들·거래량이 없는 순수 라인 차트라 별도 렌더러로 분리(종목 상세 밸류에이션 밴드).
 */

export interface BandLine {
  label: string;
  multiple: number;
  series: { date: string; value: number }[];
}

interface Props {
  price: { date: string; close: number }[];
  bands: BandLine[];
  height: number;
}

interface ChartTheme {
  background: string;
  textColor: string;
  gridColor: string;
  borderColor: string;
  priceColor: string;
}

function getChartTheme(isDark: boolean): ChartTheme {
  return isDark
    ? { background: '#1f2937', textColor: '#9ca3af', gridColor: '#374151', borderColor: '#4b5563', priceColor: '#f8fafc' }
    : { background: '#ffffff', textColor: '#6b7280', gridColor: '#f3f4f6', borderColor: '#e5e7eb', priceColor: '#111827' };
}

/**
 * 밴드 5선(하위→상위 분위수) 색상. 같은 계열의 명도 차이만으로는 선이 겹칠 때 구분이 안 되므로
 * 저평가(아래)=초록 → 고평가(위)=빨강의 발산형 색상으로 의미까지 함께 읽히게 한다.
 * 범례(ValuationBands)와 색을 공유해야 하므로 export.
 */
export const BAND_COLORS = ['#059669', '#84cc16', '#eab308', '#f97316', '#dc2626'];

export function ValuationBandChart({ price, bands, height }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || price.length === 0) return;

    const isDark = document.documentElement.classList.contains('dark');
    const theme = getChartTheme(isDark);

    const chart = createChart(container, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: theme.background }, textColor: theme.textColor, fontSize: 11 },
      grid: { vertLines: { color: theme.gridColor }, horzLines: { color: theme.gridColor } },
      rightPriceScale: { borderColor: theme.borderColor },
      timeScale: { borderColor: theme.borderColor },
      crosshair: { mode: 0 },
      localization: { priceFormatter: (p: number) => p.toLocaleString('ko-KR') },
    });
    chartRef.current = chart;

    // 주가선은 밴드선 위로 도드라져야 하므로 굵은 실선 + 마지막 값 표시
    const priceLine = chart.addSeries(LineSeries, {
      color: theme.priceColor,
      lineWidth: 3,
      priceLineVisible: false,
      lastValueVisible: true,
    });
    priceLine.setData(
      price.map((p) => ({ time: p.date as unknown as UTCTimestamp, value: p.close })),
    );

    // 밴드선은 점선으로 그려 실선인 주가선과 한눈에 구분되게 한다. 차트 위 title 오버레이는
    // 5개가 겹쳐 오히려 가독성을 해쳐 제거하고, 색·배수는 차트 아래 범례에서 안내한다.
    bands.forEach((band, i) => {
      if (band.series.length === 0) return;
      const line = chart.addSeries(LineSeries, {
        color: BAND_COLORS[i % BAND_COLORS.length],
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      line.setData(
        band.series.map((p) => ({ time: p.date as unknown as UTCTimestamp, value: p.value })),
      );
    });

    chart.timeScale().fitContent();

    return () => {
      chartRef.current = null;
      chart.remove();
    };
  }, [price, bands, height]);

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

  return <div ref={containerRef} style={{ height, width: '100%' }} />;
}
