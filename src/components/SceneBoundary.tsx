/**
 * SceneBoundary — error boundary for the Three.js / R3F canvas.
 *
 * A single NaN LiDAR coordinate or a malformed frame can throw inside the
 * render loop and, with no boundary, white-screen the entire app. This keeps
 * the failure local: the rest of the UI stays alive, the user gets a themed
 * "scene failed — retry" panel, and the crash is reported to Sentry tagged with
 * the surface that broke. Reliability as a feature, not an afterthought.
 */

import type { ReactNode } from "react";
import { Sentry } from "../lib/sentry";
import { colors, fonts, typeScale, spacing } from "../theme";

export default function SceneBoundary({
  children,
  label = "3d-scene",
  resetKey,
}: {
  children: ReactNode;
  label?: string;
  /** Change this (e.g. the scenario id) to auto-clear a prior error on new data. */
  resetKey?: string | number;
}) {
  return (
    <Sentry.ErrorBoundary
      key={resetKey}
      beforeCapture={(scope) => {
        scope.setTag("boundary", label);
        scope.setTag("event_kind", "render_crash");
      }}
      fallback={({ error, resetError }) => (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: spacing.md,
            background: colors.bgDeep,
            padding: spacing.xl,
            textAlign: "center",
          }}
        >
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: "50%",
              background: "rgba(239,68,68,0.12)",
              border: `1px solid ${colors.error}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: colors.error,
              fontSize: 20,
            }}
          >
            ⚠
          </div>
          <div style={{ ...typeScale.h3, color: colors.textPrimary }}>
            Scene failed to render
          </div>
          <div
            style={{
              ...typeScale.mono,
              color: colors.textDim,
              maxWidth: 360,
              wordBreak: "break-word",
            }}
          >
            {error instanceof Error ? error.message : String(error)}
          </div>
          <button
            onClick={resetError}
            style={{
              marginTop: spacing.xs,
              padding: "7px 16px",
              fontFamily: fonts.sans,
              fontSize: 12,
              fontWeight: 500,
              color: colors.accent,
              background: "rgba(0,232,157,0.08)",
              border: `1px solid ${colors.borderAccent}`,
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            Reload scene
          </button>
        </div>
      )}
    >
      {children}
    </Sentry.ErrorBoundary>
  );
}
