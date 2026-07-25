import { Component, ErrorInfo, ReactNode } from "react";

interface Props { children: ReactNode }
interface State { error: Error | null }

// Catches render errors so a crash shows a message + reload instead of a blank page.
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("UI crash:", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="center-screen">
          <div className="login-card" style={{ width: 380, textAlign: "center" }}>
            <h1>Something went wrong</h1>
            <p className="muted" style={{ fontSize: 13 }}>
              The page hit an error. Reload to continue — your data is safe.
            </p>
            <button onClick={() => window.location.reload()}>Reload</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
