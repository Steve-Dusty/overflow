/**
 * Overflow backend — a small, instrumented Express server that:
 *   1. Proxies OpenAI chat completions (key stays server-side, off the browser),
 *      wrapping each call in a Sentry `gen_ai` span with model + token usage →
 *      shows up in Sentry's AI/LLM monitoring + as a child of the browser's
 *      distributed trace.
 *   2. Mocks the OpenEnv policy (/api/predict) so the sim loop produces
 *      server-side inference spans too.
 *   3. Tunnels browser Sentry envelopes (/api/tunnel) to bypass ad-blockers.
 *
 * Sentry init happens in instrument.mjs (loaded via `node --import`).
 */
import express from "express";
import cors from "cors";
import * as Sentry from "@sentry/node";
import OpenAI from "openai";

const PORT = process.env.PORT || 8787;
// SSRF guard: the tunnel only forwards to Sentry ingest hosts.
const SENTRY_INGEST_HOST = /(^|\.)ingest\.(\w+\.)?sentry\.io$/;

const apiKey = process.env.OPENAI_API_KEY || "";
const hasOpenAI = apiKey.length > 20;
const openai = new OpenAI({ apiKey });

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    openai: hasOpenAI,
    sentry: Boolean(process.env.SENTRY_DSN_SERVER || process.env.SENTRY_DSN),
  });
});

// ---------------------------------------------------------------------------
// Sentry tunnel — forward browser envelopes so ad-blockers can't drop events.
// ---------------------------------------------------------------------------
app.post("/api/tunnel", express.text({ type: () => true, limit: "1mb" }), async (req, res) => {
  try {
    const envelope = req.body;
    const header = JSON.parse(envelope.split("\n")[0]);
    const dsn = new URL(header.dsn);
    if (!SENTRY_INGEST_HOST.test(dsn.host)) {
      return res.status(400).json({ error: "untrusted dsn host" });
    }
    const projectId = dsn.pathname.replace(/^\//, "");
    const upstream = `https://${dsn.host}/api/${projectId}/envelope/`;
    const r = await fetch(upstream, {
      method: "POST",
      body: envelope,
      headers: { "Content-Type": "application/x-sentry-envelope" },
    });
    res.status(r.status).send(await r.text());
  } catch {
    res.status(400).json({ error: "bad envelope" });
  }
});

// ---------------------------------------------------------------------------
// AI chat proxy — instrumented gen_ai span with token usage.
// ---------------------------------------------------------------------------
async function chat({ system, user, model = "gpt-4o-mini", temperature = 0.7, maxTokens = 1500 }) {
  return Sentry.startSpan(
    {
      op: "gen_ai.chat",
      name: `chat ${model}`,
      attributes: {
        "gen_ai.system": "openai",
        "gen_ai.operation.name": "chat",
        "gen_ai.request.model": model,
        "gen_ai.request.temperature": temperature,
        "gen_ai.request.max_tokens": maxTokens,
      },
    },
    async (span) => {
      const completion = await openai.chat.completions.create({
        model,
        temperature,
        max_tokens: maxTokens,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      });
      const u = completion.usage;
      if (u) {
        span.setAttribute("gen_ai.usage.input_tokens", u.prompt_tokens);
        span.setAttribute("gen_ai.usage.output_tokens", u.completion_tokens);
        span.setAttribute("gen_ai.usage.total_tokens", u.total_tokens);
      }
      span.setAttribute("gen_ai.response.model", completion.model);
      return {
        text: completion.choices?.[0]?.message?.content ?? "",
        usage: u ?? null,
        model: completion.model,
      };
    },
  );
}

app.post("/api/chat", async (req, res, next) => {
  try {
    if (!hasOpenAI) return res.status(503).json({ error: "no_api_key" });
    const { system, user, model, temperature, maxTokens } = req.body ?? {};
    if (!system || !user) return res.status(400).json({ error: "system and user are required" });
    Sentry.logger?.info?.("ai.chat.request", { model: model ?? "gpt-4o-mini" });
    const out = await chat({ system, user, model, temperature, maxTokens });
    res.json(out);
  } catch (err) {
    next(err); // hand to Sentry's express error handler
  }
});

// ---------------------------------------------------------------------------
// Mock OpenEnv policy — server-side inference span (distributed tracing demo).
// ---------------------------------------------------------------------------
const ACTIONS = [
  "keep_lane", "brake_mild", "brake_hard", "accelerate",
  "merge_left", "merge_right", "yield", "nudge_left", "nudge_right",
];
app.post("/api/predict", (req, res) => {
  const { nearestObjectDist = 20, frameIndex = 0, scenarioId = "unknown" } = req.body ?? {};
  Sentry.startSpan(
    { op: "openenv.predict", name: "policy.getActionAndReward", attributes: { scenario: scenarioId, frame: frameIndex } },
    (span) => {
      const close = nearestObjectDist < 5;
      const action = close
        ? (Math.random() < 0.7 ? "brake_hard" : "yield")
        : ACTIONS[Math.floor(Math.random() * 4)];
      const reward = close ? 0.5 + Math.random() * 0.4 : 0.6 + Math.random() * 0.3;
      span.setAttribute("action", action);
      span.setAttribute("reward", reward);
      res.json({
        action,
        reward: Math.round(reward * 1000) / 1000,
        branchId: `srv-${frameIndex}`,
        explanation: "Server-side OpenEnv policy (mock).",
        timestamp: Date.now(),
        latencyMs: 0,
      });
    },
  );
});

// Sentry's express error handler (only if initialized), then a JSON fallback.
if (Sentry.getClient()) {
  Sentry.setupExpressErrorHandler(app);
}
app.use((err, _req, res, _next) => {
  res.status(500).json({ error: err?.message || "internal error" });
});

app.listen(PORT, () => {
  console.log(
    `[overflow-server] http://localhost:${PORT}  ` +
    `(openai=${hasOpenAI}, sentry=${Boolean(process.env.SENTRY_DSN_SERVER || process.env.SENTRY_DSN)})`,
  );
});
