import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  failed: boolean;
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Tastelog UI crashed", error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <main className="error-state" role="alert">
        <p className="eyebrow">草稿仍保存在這台裝置</p>
        <h1>畫面暫時卡住了</h1>
        <p>重新載入即可繼續；如果仍然出現，請把畫面截圖傳給 Admin。</p>
        <button type="button" className="primary-action" onClick={() => window.location.reload()}>
          重新載入
        </button>
      </main>
    );
  }
}
