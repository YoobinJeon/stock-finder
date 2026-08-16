/**
 * IBD 스타일 RS(상대강도) 백분위 시각화 공용 컴포넌트.
 * RS 랭킹 페이지(게이지 바·히트맵·섹터 보드)와 스크리너(미니 배지)에서 공유.
 * 상승=red 하락=blue 관행에 맞춰 강세일수록 진한 red, 약세(RS<50)는 blue로 톤을 나눈다.
 */

export interface RsToneClasses {
  /** 배경 틴트 클래스 (히트맵 셀·카드용). 중립(50~64)은 빈 문자열 = 투명 */
  bg: string;
  text: string;
}

/** RS 게이지 바의 채움 색상 — 5단계: 90+/80+/65+/50+/50미만 */
export function rsBarFillClass(rs: number | null): string {
  if (rs == null) return 'bg-gray-200';
  if (rs >= 90) return 'bg-red-500';
  if (rs >= 80) return 'bg-red-400';
  if (rs >= 65) return 'bg-amber-400';
  if (rs >= 50) return 'bg-gray-300';
  return 'bg-blue-400';
}

/**
 * 히트맵 셀·섹터 카드 배경 틴트 + 텍스트 톤. 같은 5단계 등급 기준을 셀 배경(옅게)에도 적용해
 * 숫자를 읽지 않아도 행/카드 패턴이 한눈에 스캔되게 한다.
 */
export function rsCellTone(rs: number | null): RsToneClasses {
  if (rs == null) return { bg: '', text: 'text-gray-400' };
  if (rs >= 90) return { bg: 'bg-red-100', text: 'text-red-700' };
  if (rs >= 80) return { bg: 'bg-red-50', text: 'text-red-600' };
  if (rs >= 65) return { bg: 'bg-amber-50', text: 'text-amber-700' };
  if (rs >= 50) return { bg: '', text: 'text-gray-600' };
  return { bg: 'bg-blue-50', text: 'text-blue-600' };
}

export function fmtRs(rs: number | null): string {
  return rs == null ? '–' : rs.toFixed(1);
}

interface RsBarProps {
  rs: number | null;
  /** 스크리너 등 좁은 컬럼용 축소 표시 */
  compact?: boolean;
  className?: string;
}

/** 수평 백분위 게이지 바 + 숫자. 채움 폭 = RS%. */
export function RsBar({ rs, compact = false, className }: RsBarProps) {
  const pct = rs == null ? 0 : Math.max(0, Math.min(100, rs));
  const fill = rsBarFillClass(rs);
  const tone = rsCellTone(rs);
  return (
    <div className={`flex items-center gap-2 justify-end ${className ?? ''}`}>
      <div
        className={`relative h-2 rounded-full bg-gray-100 overflow-hidden shrink-0 ${compact ? 'w-10' : 'w-20 sm:w-24'}`}
        title={`RS 백분위 ${fmtRs(rs)}`}
      >
        <div className={`h-full rounded-full ${fill}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`font-bold tabular-nums ${compact ? 'text-xs' : 'text-sm'} ${tone.text}`}>{fmtRs(rs)}</span>
    </div>
  );
}
