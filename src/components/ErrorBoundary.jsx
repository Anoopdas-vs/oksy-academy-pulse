import React from "react";
import { reportError } from "../lib/monitoring.js";

// Top-level safety net: without this, a single uncaught render error
// (a malformed record, an unexpected null field, a chart-library edge
// case) blanks the entire screen for that user with no way back except a
// manual reload — in an app whose whole job is letting staff record money.
// See the engineering review, finding H2.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error("Unhandled error in the app:", error, info?.componentStack);
    reportError(error, { componentStack: info?.componentStack });
  }

  render() {
    if (this.state.error) {
      return (
        <div className="auth-shell">
          <div className="auth-card status-card">
            <h2>Something went wrong</h2>
            <p>
              The app hit an unexpected error and had to stop to avoid showing you
              anything unreliable. Nothing you had already saved is affected.
            </p>
            <p className="table-sub">{String(this.state.error?.message || this.state.error)}</p>
            <button
              className="button primary"
              onClick={() => {
                this.setState({ error: null });
                window.location.reload();
              }}
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
