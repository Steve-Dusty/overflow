/**
 * Sentry initialization — per the Sentry React SDK skill, imported as the FIRST
 * line of main.tsx so monitoring is installed before any other module runs.
 *
 * Dormant until VITE_SENTRY_DSN is set: we skip init entirely so the app behaves
 * byte-for-byte identically without a DSN. App-specific helpers live in
 * ./lib/sentry (the incident bridge, inference tracing, structured logs).
 */

import * as Sentry from "@sentry/react";
import { useEffect } from "react";
import {
  useLocation,
  useNavigationType,
  createRoutesFromChildren,
  matchRoutes,
} from "react-router-dom";

const dsn = import.meta.env.VITE_SENTRY_DSN;
const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8787";

if (dsn) {
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    release: import.meta.env.VITE_SENTRY_RELEASE,
    // Route browser events through the backend tunnel to dodge ad-blockers.
    // Opt-in (VITE_SENTRY_TUNNEL) so it never silently breaks delivery when the
    // backend is down — falls back to sending Sentry directly.
    tunnel: import.meta.env.VITE_SENTRY_TUNNEL || undefined,

    integrations: [
      // Route-aware tracing for react-router v7 → parameterized transactions
      // ("/sim", "/dashboard") instead of raw URLs. Pairs with
      // withSentryReactRouterV7Routing in App.
      Sentry.reactRouterV7BrowserTracingIntegration({
        useEffect,
        useLocation,
        useNavigationType,
        createRoutesFromChildren,
        matchRoutes,
      }),
      // Session Replay — unmasked on purpose (no-PII AV dashboard, legible demo).
      Sentry.replayIntegration({ maskAllText: false, blockAllMedia: false }),
      // Continuous profiling of the heavy 3D / LiDAR-raytrace render path.
      // (Needs the `Document-Policy: js-profiling` header to actually sample —
      // added in vite.config.ts.)
      Sentry.browserProfilingIntegration(),
      // In-app "report a bug" widget → screenshot + description into Sentry.
      Sentry.feedbackIntegration({ colorScheme: "dark", showBranding: false }),
    ],

    tracesSampleRate: 1.0,
    profilesSampleRate: 1.0,
    // Propagate trace headers to same-origin, localhost, and the backend so a
    // single action shows as ONE distributed trace: browser → backend → OpenAI.
    tracePropagationTargets: ["localhost", /^\//, API_BASE],
    replaysSessionSampleRate: 1.0,
    replaysOnErrorSampleRate: 1.0,
    enableLogs: true,

    initialScope: { tags: { surface: "overflow-web" } },
  });

  // Synthetic but stable session identity so every event/replay has an actor.
  try {
    let sid = localStorage.getItem("overflow_sid");
    if (!sid) {
      sid = crypto.randomUUID?.() ?? `sid-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem("overflow_sid", sid);
    }
    Sentry.setUser({ id: sid, username: `demo-${sid.slice(0, 8)}` });
  } catch {
    /* localStorage unavailable — skip user identity */
  }
} else if (import.meta.env.DEV) {
  console.info("[sentry] VITE_SENTRY_DSN not set — error monitoring is disabled.");
}
