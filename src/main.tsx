// MUST be first: initializes Sentry before any other module runs (Sentry React skill).
import "./instrument";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import * as Sentry from "@sentry/react";
import "./index.css";
import App from "./App";
import { colors, fonts } from "./theme";

function RootFallback({ error }: { error: unknown }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        background: colors.bgDeep,
        color: colors.textPrimary,
        fontFamily: fonts.sans,
        padding: 32,
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: 15, fontWeight: 600 }}>Something went wrong</div>
      <div
        style={{
          fontFamily: fonts.mono,
          fontSize: 12,
          color: colors.textDim,
          maxWidth: 460,
          wordBreak: "break-word",
        }}
      >
        {error instanceof Error ? error.message : String(error)}
      </div>
      <button
        onClick={() => window.location.reload()}
        style={{
          marginTop: 4,
          padding: "8px 20px",
          fontFamily: fonts.sans,
          fontSize: 13,
          fontWeight: 500,
          color: colors.bgDeep,
          background: colors.accent,
          border: "none",
          borderRadius: 6,
          cursor: "pointer",
        }}
      >
        Reload app
      </button>
    </div>
  );
}

createRoot(document.getElementById("root")!, {
  // React 19 error hooks (Sentry React skill). We report uncaught + recoverable
  // errors here; errors *caught* by our ErrorBoundaries are already reported by
  // those boundaries, so onCaughtError is intentionally omitted to avoid double-counting.
  onUncaughtError: Sentry.reactErrorHandler(),
  onRecoverableError: Sentry.reactErrorHandler(),
}).render(
  <StrictMode>
    <Sentry.ErrorBoundary fallback={(props) => <RootFallback error={props.error} />}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </Sentry.ErrorBoundary>
  </StrictMode>,
);
