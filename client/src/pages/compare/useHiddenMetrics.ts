import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'sf_compare_metrics';

/** localStorage 값을 안전하게 파싱 — 실패·비배열·비문자열 항목이면 무시하고 기본값(빈 배열=전체 표시). */
function readHiddenLabels(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === 'string');
  } catch {
    return [];
  }
}

interface UseHiddenMetricsResult {
  hidden: Set<string>;
  toggle: (label: string) => void;
  reset: () => void;
}

/**
 * 종목 비교 테이블의 숨긴 지표(label) 상태 — localStorage(`sf_compare_metrics`)에 영속화.
 * 저장값 = 숨긴 지표 label 배열(기본 전체 표시). 파싱 실패 시 기본값으로 무시.
 */
export function useHiddenMetrics(): UseHiddenMetricsResult {
  const [hiddenLabels, setHiddenLabels] = useState<string[]>(() => readHiddenLabels());

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(hiddenLabels));
    } catch {
      // localStorage 사용 불가(프라이빗 모드 등) — 세션 내 상태만 유지, 조용히 무시
    }
  }, [hiddenLabels]);

  const toggle = useCallback((label: string) => {
    setHiddenLabels((prev) => (
      prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label]
    ));
  }, []);

  const reset = useCallback(() => setHiddenLabels([]), []);

  return { hidden: new Set(hiddenLabels), toggle, reset };
}
