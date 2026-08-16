/**
 * 종목 상세 패널의 최상위 섹션 공통 클래스.
 *
 * 기존 `border-t border-gray-100`은 흰 배경에서 거의 보이지 않아 섹션 위아래 경계가
 * 뭉개졌다(실사용 피드백) — 굵은 띠(border-t-8)로 구분을 확실히 한다. gray-100은 다크
 * 모드에서 surface보다 밝은 값으로 반전되므로 두 테마 모두에서 띠가 보인다.
 *
 * StockDetailPanel과 그 하위 섹션 컴포넌트(CreditBalanceSection·ValuationBands)가 함께
 * 쓰는데, 패널에서 export하면 순환 참조가 되므로 별도 모듈로 둔다.
 */
export const SECTION_CLASS = 'px-6 pt-5 border-t-8 border-gray-100';
