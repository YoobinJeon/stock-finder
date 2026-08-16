import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Layout } from './shared/components/Layout';
import { RouteErrorBoundary } from './shared/components/RouteErrorBoundary';
import { showToast } from './shared/components/Toaster';
import { apiErrorMessage } from './shared/lib/apiError';
import { DashboardPage } from './pages/DashboardPage';

// 대시보드는 진입 경로라 정적 import로 둔다 — lazy로 돌리면 첫 화면이 청크 요청 한 번을
// 더 기다린다. 나머지 화면은 실제로 이동할 때 받아오게 해 초기 번들에서 덜어낸다.
const ScreenerPage = lazy(() => import('./pages/ScreenerPage').then((m) => ({ default: m.ScreenerPage })));
const ComparePage = lazy(() => import('./pages/ComparePage').then((m) => ({ default: m.ComparePage })));
const StrategiesPage = lazy(() => import('./pages/StrategiesPage').then((m) => ({ default: m.StrategiesPage })));
const SignalsPage = lazy(() => import('./pages/SignalsPage').then((m) => ({ default: m.SignalsPage })));
const SectorsPage = lazy(() => import('./pages/SectorsPage').then((m) => ({ default: m.SectorsPage })));
const FlowsPage = lazy(() => import('./pages/FlowsPage').then((m) => ({ default: m.FlowsPage })));
const TurnoverPage = lazy(() => import('./pages/TurnoverPage').then((m) => ({ default: m.TurnoverPage })));
const RsPage = lazy(() => import('./pages/RsPage').then((m) => ({ default: m.RsPage })));
const EtfPage = lazy(() => import('./pages/EtfPage').then((m) => ({ default: m.EtfPage })));
const PeersPage = lazy(() => import('./pages/PeersPage').then((m) => ({ default: m.PeersPage })));
const ThemesPage = lazy(() => import('./pages/ThemesPage').then((m) => ({ default: m.ThemesPage })));
const BacktestPage = lazy(() => import('./pages/BacktestPage').then((m) => ({ default: m.BacktestPage })));
const DataPage = lazy(() => import('./pages/DataPage').then((m) => ({ default: m.DataPage })));
const CalendarPage = lazy(() => import('./pages/CalendarPage').then((m) => ({ default: m.CalendarPage })));
const SectorOutlookPage = lazy(() => import('./pages/SectorOutlookPage').then((m) => ({ default: m.SectorOutlookPage })));
const MonthlyMoversPage = lazy(() => import('./pages/MonthlyMoversPage').then((m) => ({ default: m.MonthlyMoversPage })));

/** 화면 청크를 받아오는 동안의 자리표시 — 각 페이지의 로딩 문구와 같은 톤으로 맞춘다 */
function RouteFallback() {
  return <p className="p-6 text-sm text-gray-400">불러오는 중…</p>;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 1000 * 60 * 5, retry: 1 },
  },
  // 쓰기 실패는 예외 없이 사용자에게 보인다. 개별 useMutation에 onError를 다는 대신
  // 여기서 한 번에 처리하는 이유: 화면이 늘어날 때마다 빠뜨릴 여지를 없애기 위함
  // (2026-07-26 리뷰 시점 mutation 26건 중 onError를 가진 것이 0건이었다).
  // 개별 화면에서 더 구체적인 처리가 필요하면 그쪽 onError를 추가로 쓰면 된다 —
  // MutationCache의 onError는 그것과 별개로 항상 함께 호출된다.
  mutationCache: new MutationCache({
    onError: (error) => showToast(apiErrorMessage(error)),
  }),
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Layout>
          <RouteErrorBoundary>
            <Suspense fallback={<RouteFallback />}>
              <Routes>
                <Route path="/" element={<DashboardPage />} />
                <Route path="/screener" element={<ScreenerPage />} />
                <Route path="/compare" element={<ComparePage />} />
                <Route path="/strategies" element={<StrategiesPage />} />
                <Route path="/signals" element={<SignalsPage />} />
                <Route path="/calendar" element={<CalendarPage />} />
                <Route path="/outlook" element={<SectorOutlookPage />} />
                <Route path="/monthly" element={<MonthlyMoversPage />} />
                <Route path="/sectors" element={<SectorsPage />} />
                <Route path="/flows" element={<FlowsPage />} />
                <Route path="/turnover" element={<TurnoverPage />} />
                <Route path="/rs" element={<RsPage />} />
                <Route path="/etf" element={<EtfPage />} />
                <Route path="/peers" element={<PeersPage />} />
                <Route path="/themes" element={<ThemesPage />} />
                <Route path="/backtest" element={<BacktestPage />} />
                <Route path="/data" element={<DataPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </RouteErrorBoundary>
        </Layout>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
