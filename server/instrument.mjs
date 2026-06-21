/**
 * Sentry (server) — loaded via `node --import ./instrument.mjs` so it runs
 * BEFORE express/openai are imported, which is what lets @sentry/node
 * auto-instrument them (HTTP server spans, OpenAI gen_ai spans) and continue
 * distributed traces propagated from the browser.
 *
 * Dormant until SENTRY_DSN_SERVER (or SENTRY_DSN) is set — server runs normally.
 */
import "dotenv/config";
import * as Sentry from "@sentry/node";

const dsn = process.env.SENTRY_DSN_SERVER || process.env.SENTRY_DSN;

// Profiling is best-effort (native module) — never let it block startup.
const integrations = [];
try {
  const { nodeProfilingIntegration } = await import("@sentry/profiling-node");
  integrations.push(nodeProfilingIntegration());
} catch {
  console.log("[sentry] @sentry/profiling-node unavailable — continuing without profiling");
}

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || "development",
    release: process.env.SENTRY_RELEASE,
    integrations,
    tracesSampleRate: 1.0,
    profilesSampleRate: 1.0,
    // Capture prompts/headers for richer AI + request debugging (no real PII here).
    sendDefaultPii: true,
  });
  console.log("[sentry] server monitoring ENABLED");
} else {
  console.log("[sentry] SENTRY_DSN_SERVER not set — server monitoring dormant (app still works)");
}
