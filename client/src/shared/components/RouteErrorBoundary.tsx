import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  failed: boolean;
}

/**
 * 렌더 실패를 잡아 빈 화면 대신 복구 안내를 보여준다.
 *
 * **왜 필요해졌나**: 화면을 청크로 쪼개면서(`lazy`) 없던 실패 모드가 생겼다 — 재빌드하면
 * 청크 파일 이름의 해시가 바뀌는데, 그 전에 열어둔 탭은 낡은 `index.html`을 들고 있어 이제
 * 없는 파일을 요청한다. 단일 번들일 때는 불가능했던 상황이고, 경계가 없으면 화면이 통째로
 * 하얗게 남는다. 이 경우 새로고침 한 번이면 최신 `index.html`을 받아 해소된다.
 *
 * **놓기 쉬운 자리가 하나 있다**: `App.tsx`의 경계는 `Layout` *안쪽*이라 라우트만 덮는다.
 * `Layout`에 들어있는 `StockSearchBox`도 상세 패널을 lazy로 받으므로 자체 경계를 따로 둔다 —
 * 그쪽이 뚫리면 라우트가 아니라 앱 전체가 죽는다.
 *
 * 에러 바운더리는 현재 React에서 클래스 컴포넌트로만 만들 수 있다(훅 대응물 없음).
 */
export class RouteErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 개인용 도구라 원격 수집처가 없다 — 콘솔에 남겨 개발자 도구로 확인할 수 있게 한다.
    console.error('[RouteErrorBoundary] 화면 렌더 실패', error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="p-6">
        <p className="text-sm text-gray-700 mb-1">화면을 불러오지 못했습니다.</p>
        <p className="text-xs text-gray-400 mb-3">
          앱이 새로 배포된 뒤 오래된 탭을 쓰고 있으면 생길 수 있습니다. 새로고침하면 해결됩니다.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="text-xs rounded-lg px-3 py-1.5 border bg-surface text-gray-600 border-gray-200 hover:bg-gray-50"
        >
          새로고침
        </button>
      </div>
    );
  }
}
