import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTheme } from '../useTheme';
import { StockSearchBox } from './StockSearchBox';
import { Toaster } from './Toaster';

const navItems = [
  { path: '/',           label: '대시보드', icon: '📊' },
  { path: '/signals',    label: '시그널',   icon: '📡' },
  { path: '/calendar',   label: '실적 캘린더', icon: '📅' },
  { path: '/sectors',    label: '산업 레이더', icon: '🔭' },
  { path: '/themes',     label: '테마 레이더', icon: '🧩' },
  { path: '/outlook',    label: '산업 실적 전망', icon: '📈' },
  { path: '/monthly',    label: '월간 상승률', icon: '📆' },
  { path: '/rs',         label: 'RS 랭킹',   icon: '📶' },
  { path: '/flows',      label: '수급 순위', icon: '💰' },
  { path: '/turnover',   label: '거래대금', icon: '💹' },
  { path: '/etf',        label: 'ETF',      icon: '📦' },
  { path: '/peers',      label: '글로벌 피어', icon: '🌐' },
  { path: '/screener',   label: '스크리너', icon: '🔍' },
  { path: '/compare',    label: '종목 비교', icon: '⚖️' },
  { path: '/strategies', label: '전략 관리', icon: '🎯' },
  { path: '/backtest',   label: '백테스트', icon: '🧪' },
  { path: '/data',       label: '데이터',   icon: '🔄' },
];

/** 사이드바 그룹핑 — path만 나열하고 navItems에서 실제 데이터(label/icon)를 그대로 재사용 */
const NAV_GROUP_DEFS: Array<{ label: string; paths: string[] }> = [
  { label: '시장 개관', paths: ['/', '/signals', '/calendar', '/sectors', '/themes', '/outlook', '/monthly', '/rs', '/flows', '/turnover', '/etf', '/peers'] },
  { label: '종목 발굴', paths: ['/screener', '/compare'] },
  { label: '전략·검증', paths: ['/strategies', '/backtest'] },
  { label: '시스템',   paths: ['/data'] },
];

const navGroups = NAV_GROUP_DEFS.map((group) => ({
  label: group.label,
  items: group.paths
    .map((path) => navItems.find((item) => item.path === path))
    .filter((item): item is (typeof navItems)[number] => item != null),
}));

export function Layout({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const { theme, toggle } = useTheme();

  // 라우트 이동 시 드로어 닫기 (모바일)
  useEffect(() => setOpen(false), [pathname]);

  // Esc로 드로어 닫기
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className="flex flex-col md:flex-row h-screen bg-gray-50">
      {/* 모바일 상단 바 (md 미만) */}
      <header className="md:hidden flex items-center justify-between h-14 px-4 bg-surface border-b border-gray-200 shrink-0 z-20 gap-2">
        <h1 className="text-base font-bold text-blue-600 shrink-0">📈 Stock Finder</h1>
        <div className="flex items-center gap-1 shrink-0">
          {/* 검색은 버튼만 두고 실제 목록은 중앙 팝업에서 — 좁은 헤더에서도 읽기 편하게 */}
          <StockSearchBox compact />
          <button
            type="button"
            aria-label="테마 전환"
            onClick={toggle}
            className="p-2 text-gray-600 hover:text-gray-900"
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
          <button
            type="button"
            aria-label="메뉴 열기"
            onClick={() => setOpen(true)}
            className="p-2 -mr-2 text-gray-600 hover:text-gray-900"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
        </div>
      </header>

      {/* 드로어 오버레이 (모바일, 열렸을 때) */}
      {open && (
        <div
          className="md:hidden fixed inset-0 bg-black/30 z-30"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* 사이드바 (데스크톱 고정) / 드로어 (모바일 슬라이드) */}
      <aside
        className={`flex flex-col bg-surface border-r border-gray-200 z-40
          fixed inset-y-0 left-0 w-64 transform transition-transform duration-200 ease-out
          md:static md:translate-x-0 md:w-56
          ${open ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="p-4 border-b border-gray-200 flex items-center justify-between">
          <h1 className="text-lg font-bold text-blue-600">📈 Stock Finder</h1>
          <button
            type="button"
            aria-label="메뉴 닫기"
            onClick={() => setOpen(false)}
            className="md:hidden p-1 -mr-1 text-gray-400 hover:text-gray-700"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>
        </div>
        {/* 전역 종목 검색 — 메뉴를 거치지 않고 종목명·코드로 바로 상세를 연다 */}
        <div className="px-3 pt-3">
          <StockSearchBox onNavigate={() => setOpen(false)} />
        </div>
        <nav className="flex-1 p-3 flex flex-col gap-1 overflow-y-auto">
          {navGroups.map((group, groupIdx) => (
            <div key={group.label}>
              <p className={`px-3 pb-1 text-[11px] font-semibold text-gray-400 tracking-wide ${groupIdx === 0 ? 'pt-1' : 'pt-3'}`}>
                {group.label}
              </p>
              {group.items.map(({ path, label, icon }) => (
                <Link
                  key={path}
                  to={path}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    pathname === path
                      ? 'bg-blue-50 text-blue-600'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  <span>{icon}</span>
                  {label}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="p-4 border-t border-gray-200 flex flex-col gap-2">
          <button
            type="button"
            aria-label="테마 전환"
            onClick={toggle}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100"
          >
            {theme === 'dark' ? '☀️ 라이트모드' : '🌙 다크모드'}
          </button>
          <p className="text-xs text-gray-400">개인용 종목 발굴 도구</p>
          <p className="text-[10px] leading-relaxed text-gray-400">
            ⚠️ 모든 정보·점수는 투자 권유가 아닌 참고 자료입니다. 주식 투자는 원금 손실이
            발생할 수 있으며, 최종 투자 결정은 본인의 책임입니다. 과거 데이터 기반 분석은
            미래 수익을 보장하지 않습니다.
          </p>
        </div>
      </aside>

      {/* 메인 콘텐츠 */}
      <main className="flex-1 overflow-auto">
        {children}
      </main>

      {/* 전역 알림 — App.tsx의 MutationCache.onError가 쓰기 실패를 여기로 보낸다 */}
      <Toaster />
    </div>
  );
}
