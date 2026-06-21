/**
 * Overflow's app-specific Sentry helpers.
 *
 * Initialization lives in ../instrument.ts (imported first in main.tsx, per the
 * Sentry React SDK skill). This module only holds the helpers the rest of the
 * app calls.
 *
 * Reliability *is* the product here: Overflow is an autonomous-driving
 * perception tool, so we treat two kinds of incident as equally observable —
 *   1. software faults  (a bad parquet, a failed policy inference, a render crash)
 *   2. driving faults    (near-misses, collisions, hard braking)
 * — and route both into Sentry. See `captureDrivingIncident` for the bridge.
 *
 * Every helper no-ops until Sentry is initialized (i.e. until VITE_SENTRY_DSN is
 * set), detected via Sentry.getClient(), so the app behaves identically without one.
 */

import * as Sentry from "@sentry/react";

/** Severity vocabulary used across the app → Sentry's level vocabulary. */
const LEVEL: Record<string, Sentry.SeverityLevel> = {
  critical: "fatal",
  high: "error",
  error: "error",
  warning: "warning",
  medium: "warning",
  caution: "warning",
  info: "info",
  low: "info",
};

/** True once instrument.ts has initialized Sentry (i.e. a DSN was present). */
function enabled(): boolean {
  return Boolean(Sentry.getClient());
}

export function sentryEnabled(): boolean {
  return enabled();
}

/** Re-export so call sites can use Sentry.ErrorBoundary / routing helpers without a second import. */
export { Sentry };

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

interface CaptureContext {
  tags?: Record<string, string>;
  contexts?: Record<string, Record<string, unknown>>;
  fingerprint?: string[];
}

/**
 * Report a caught exception with structured context. Safe (and quiet) when
 * Sentry is disabled — falls back to console.error in dev so nothing is lost.
 */
export function captureError(err: unknown, context?: CaptureContext): void {
  if (!enabled()) {
    if (import.meta.env.DEV) console.error("[sentry:disabled]", err, context);
    return;
  }
  Sentry.captureException(err, {
    tags: context?.tags,
    contexts: context?.contexts,
    fingerprint: context?.fingerprint,
  });
}

/** Drop a breadcrumb onto the current scope (shows up on the next event). */
export function breadcrumb(
  category: string,
  message: string,
  data?: Record<string, unknown>,
  level: Sentry.SeverityLevel = "info",
): void {
  if (!enabled()) return;
  Sentry.addBreadcrumb({ category, message, data, level });
}

/** Tag the active scenario globally so every event/trace is filterable by it. */
export function setSentryScenario(scenarioId: string): void {
  if (!enabled()) return;
  Sentry.getCurrentScope().setTag("scenario", scenarioId);
}

/** Structured logs (Sentry.logger.*). No-op until Sentry is initialized. */
export const log = {
  info(message: string, attributes?: Record<string, unknown>): void {
    if (enabled()) Sentry.logger.info(message, attributes);
  },
  warn(message: string, attributes?: Record<string, unknown>): void {
    if (enabled()) Sentry.logger.warn(message, attributes);
  },
  error(message: string, attributes?: Record<string, unknown>): void {
    if (enabled()) Sentry.logger.error(message, attributes);
  },
};

// ---------------------------------------------------------------------------
// Performance — inference tracing
// ---------------------------------------------------------------------------

/**
 * Wrap an OpenEnv policy-inference call in a performance span so latency is
 * observable exactly like a production API call. `startSpan` still executes the
 * callback when Sentry is off, so this is always safe to wrap around inference.
 *
 * @param attributes  input attributes known up-front (mode, model, scenario…)
 * @param resultAttrs  optional extractor for output attributes (reward, action…)
 */
export function traceInference<T>(
  name: string,
  attributes: Record<string, string | number | boolean>,
  fn: () => Promise<T>,
  resultAttrs?: (result: T) => Record<string, string | number | boolean>,
): Promise<T> {
  return Sentry.startSpan(
    { name, op: "openenv.predict", attributes },
    async (span) => {
      const out = await fn();
      if (span && resultAttrs) {
        for (const [k, v] of Object.entries(resultAttrs(out))) span.setAttribute(k, v);
      }
      return out;
    },
  );
}

// ---------------------------------------------------------------------------
// The incident bridge — a *driving* fault becomes a Sentry issue
// ---------------------------------------------------------------------------

export interface DrivingIncidentReport {
  /** Human label, e.g. "Collision Risk" or "near_miss". */
  kind: string;
  /** "critical" | "high" | "warning" | "info" | … (mapped to a Sentry level). */
  severity: string;
  scenarioId: string;
  frame: number;
  time: number;
  detail: string;
  objectId?: string;
  /** Numeric telemetry (ttc, clearance, egoSpeed, reward, …). */
  metrics?: Record<string, number>;
}

/**
 * Route a detected driving incident into Sentry as a first-class issue. This is
 * the literal expression of "reliability = safety": an unsafe ego maneuver is
 * triaged with the same machinery as a software crash.
 *
 * Events are fingerprinted by (scenario, kind) so repeated near-misses roll up
 * into one issue instead of flooding the stream. Dedup of *firing rate* is the
 * caller's job (ToastNotifications already throttles per object).
 */
export function captureDrivingIncident(report: DrivingIncidentReport): void {
  if (!enabled()) return;

  const level = LEVEL[report.severity] ?? "warning";

  Sentry.withScope((scope) => {
    scope.setLevel(level);
    scope.setTag("event_kind", "driving_incident");
    scope.setTag("incident.kind", report.kind);
    scope.setTag("incident.severity", report.severity);
    scope.setTag("scenario", report.scenarioId);
    scope.setContext("driving_incident", {
      frame: report.frame,
      time_s: report.time,
      object_id: report.objectId ?? null,
      detail: report.detail,
      ...report.metrics,
    });
    scope.setFingerprint(["driving-incident", report.scenarioId, report.kind]);
    Sentry.captureMessage(`[AV] ${report.kind} — ${report.detail}`, level);
  });
}
