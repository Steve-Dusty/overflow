# The Overflow Agent Stack

Overflow isn't just an AV-perception dashboard — it runs a **fleet of AI agents** that
review autonomous-vehicle safety. Those agents sit on three complementary pieces of
agent infrastructure, each answering a different hard question:

| Layer | Question it answers | SDK | Where |
|-------|--------------------|-----|-------|
| **ArmorIQ** | *Is this agent allowed to do this?* — governance | `@armoriq/sdk` | `scripts/armoriq_*.mjs` |
| **AgentSpan** | *Does the work survive a crash?* — durability | `agentspan` | `scripts/agentspan_*.py` |
| **Band** | *Can agents find each other and collaborate?* — coordination | `band-sdk` | `scripts/band_agents.py` |

One domain — AV safety over the Waymo demo scenes (`public/demo_data/`) — made
**governed**, **durable**, and **collaborative**. All three stacks share the same
domain logic (`scripts/agentspan_tools.py`), so they operate on one set of tools.

## The story in five acts

1. **Perception.** The perception agent classifies every road agent in each scene
   (vehicles, pedestrians, cyclists).
2. **Risk audit.** The safety auditor scores each scenario's worst incident on a 0–1
   collision-risk scale — on the real data: **Jaywalker 0.86, Red-light 0.84,
   Rear-end 0.83**. It returns a *typed, validated* `FleetRiskReport` (AgentSpan
   **structured output**).
3. **Planning.** The planner proposes a safe ego maneuver per high-risk scenario
   (jaywalker → `emergency_brake`, rear_end → `brake_and_widen_gap`, …).
4. **Policy, gated.** The policy agent drafts updates and, for the worst scenario,
   calls the **sensitive** `override_safety_limit` and `deploy_policy` tools. These are
   `approval_required` — AgentSpan **pauses for a human** before they run — and a
   **guardrail** (`no_unsafe_policy`) makes it impossible for the agent to ever
   recommend disabling safety.
5. **Durability.** Every step is a Conductor workflow task with state on the server.
   If the process dies mid-review, `agentspan_resume.py` reconnects by execution-id and
   finishes from the exact step. *The process dies; the agent doesn't.*

Meanwhile **Band** makes the same agents discoverable: the auditor doesn't call the
planner through hard-coded wiring — it `@mentions` `overflow-planner-agent`, and Band
routes by description. A new agent can join the review just by registering a
description.

## Run it

```bash
# one-time setup (agents reuse the OpenAI key in server/.env)
uv venv .venv && uv pip install -r requirements-agents.txt

npm run agentspan            # durable single safety agent  (verified: COMPLETED)
npm run agentspan:fleet      # full durable pipeline         (verified: COMPLETED)
npm run agentspan:resume     # crash & resume-by-id demo
npm run agentspan:hitl       # sensitive action pauses for human approval (verified)
npm run agentspan:test       # deterministic test, no LLM/server
npm run agentspan:tui        # inspect the runtime (or http://localhost:6767)

npm run band -- auditor --selftest   # Band role logic, offline
npm run band -- auditor              # connect live (needs a UUID in band_agent_config.yaml)
```

## Verified vs. what needs your dashboards

- **Runs live today:** both AgentSpan entry points complete end-to-end against
  overflow's own OpenAI key (`server/.env`) on the local AgentSpan runtime —
  structured output, guardrails, memory and sensitive-action gating all exercised.
  `agentspan agent list` shows `overflow-safety-agent` and `overflow-av-safety-fleet`
  registered.
- **AgentSpan cloud dashboard (Orkes):** the local runtime doesn't retain a searchable
  execution history; for the persistent cloud dashboard set `AGENTSPAN_API_KEY` /
  `AGENTSPAN_API_SECRET` (from the AgentSpan dashboard, tied to your Orkes login) and
  `AGENTSPAN_SERVER_URL`.
- **Band dashboard:** create one Remote Agent per role at app.band.ai, paste each UUID
  into `band_agent_config.yaml`, then `npm run band -- <role>`. The agent connects with
  your `BAND_API_KEY` and appears in the Band dashboard, where the `@mention`
  coordination becomes visible. (Until then, roles run in offline self-test mode.)

## The pitch

The same `assess_risk` / `plan_maneuver` / `deploy_policy` logic is shared across all
three stacks, so the AV-safety fleet is simultaneously **governed** (ArmorIQ signs and
checks each action), **durable** (AgentSpan persists, retries, resumes), and
**collaborative** (Band discovery + @mention) — production-grade agent infrastructure,
applied to autonomous-vehicle safety.
