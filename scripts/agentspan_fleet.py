#!/usr/bin/env python3
"""
Overflow AV-Safety Fleet — a durable multi-agent pipeline on AgentSpan.

Mirrors the ArmorIQ fleet (scripts/armoriq_fleet.mjs), but as a real AgentSpan
multi-agent workflow that uses the *full* feature surface:

    perception  >>  safety-auditor  >>  planner  >>  policy   (SEQUENTIAL, durable)

    • Durable execution  — compiles to a Conductor workflow; state on the server,
                           automatic retries, resumable (see agentspan_resume.py).
    • Structured output  — the auditor returns a typed, validated FleetRiskReport.
    • Guardrails         — the policy agent can never recommend disabling safety.
    • Memory             — ConversationMemory carries context across the pipeline.
    • Human-in-the-loop  — override_safety_limit / deploy_policy pause for approval,
                           driven by polling handle.get_status() (is_waiting/pending_tool).

    npm run agentspan:fleet
    npm run agentspan:fleet -- --plan                  # dry-run plan, no LLM
    AGENTSPAN_AUTO_APPROVE=0 npm run agentspan:fleet   # prompt before each sensitive action
    AGENTSPAN_HITL=0 npm run agentspan:fleet           # disable approval gating entirely

Prereqs: an LLM key (overflow's lives in server/.env) — the runtime auto-starts locally.
"""
from __future__ import annotations

import os
import sys
import time

from pydantic import BaseModel

from agentspan.agents import (
    Agent,
    AgentRuntime,
    ConversationMemory,
    Guardrail,
    GuardrailResult,
    RegexGuardrail,
    Strategy,
)

import agentspan_tools as T

MODEL = T.pick_model()
AUTO_APPROVE = os.environ.get("AGENTSPAN_AUTO_APPROVE", "1").lower() not in ("0", "false", "no", "")


# --- structured output: the auditor returns a typed, validated risk report --- #
class ScenarioRisk(BaseModel):
    scenarioId: str = ""
    riskScore: float = 0.0
    worstIncident: str = ""


class FleetRiskReport(BaseModel):
    scenarios: list[ScenarioRisk] = []
    highestRisk: str = ""
    summary: str = ""


# --- guardrail: the policy agent may never recommend disabling safety -------- #
_UNSAFE = ("disable all safety", "remove safety limit", "ignore pedestrian", "turn off braking")


def _no_unsafe_policy(text: str) -> GuardrailResult:
    bad = next((p for p in _UNSAFE if p in text.lower()), None)
    return GuardrailResult(passed=bad is None, message=(f"blocked unsafe policy: '{bad}'" if bad else ""))


def _c(code):
    return lambda s: f"\x1b[{code}m{s}\x1b[0m"


dim, bold, green, red, yellow, cyan = _c("2"), _c("1"), _c("32"), _c("31"), _c("33"), _c("36")

# --------------------------------------------------------------------------- #
# the four worker agents
# --------------------------------------------------------------------------- #
perception = Agent(
    name="overflow-perception-agent",
    model=MODEL,
    instructions=(
        "Detect and classify every road agent across all scenarios. For each scenario from "
        "list_scenarios, call detect_objects and classify_threats, then summarize the scene set."
    ),
    tools=[T.list_scenarios, T.detect_objects, T.classify_threats],
    max_turns=30,
)
auditor = Agent(
    name="overflow-safety-auditor",
    model=MODEL,
    instructions=(
        "Audit every scenario and score collision risk with assess_risk. Return a FleetRiskReport: "
        "one ScenarioRisk per scenario, the highest-risk scenarioId, and a one-line summary."
    ),
    tools=[T.list_scenarios, T.assess_risk],
    output_type=FleetRiskReport,          # structured, validated output
    max_turns=30,
)
planner = Agent(
    name="overflow-planner-agent",
    model=MODEL,
    instructions=(
        "For each high-risk scenario (risk > 0.5 per assess_risk), plan a safe ego maneuver "
        "with plan_maneuver. Output the scenario→maneuver mapping."
    ),
    tools=[T.list_scenarios, T.assess_risk, T.plan_maneuver],
    max_turns=30,
)
policy = Agent(
    name="overflow-policy-agent",
    model=MODEL,
    instructions=(
        "Draft policy updates for the highest-risk scenarios with draft_policy. Then, for the "
        "single worst scenario, call override_safety_limit and deploy_policy — these are SENSITIVE "
        "and will pause for human approval. Finally call write_report summarizing the fleet's "
        "findings and the actions taken. Never recommend disabling safety systems."
    ),
    tools=[T.list_scenarios, T.assess_risk, T.draft_policy, T.override_safety_limit, T.deploy_policy, T.write_report],
    guardrails=[
        # NOTE: guardrail names must be identifier-safe (no hyphens) — AgentSpan embeds
        # them in a Conductor condition expression, where "a-b" parses as subtraction.
        RegexGuardrail(patterns=list(_UNSAFE), name="no_unsafe_policy", message="policy must not disable safety"),
        Guardrail(func=_no_unsafe_policy, name="risk_gate"),
    ],
    max_turns=40,
)

# --------------------------------------------------------------------------- #
# compose the durable sequential pipeline, with shared memory
# (sugar equivalent:  fleet = perception >> auditor >> planner >> policy)
# --------------------------------------------------------------------------- #
fleet = Agent(
    name="overflow-av-safety-fleet",
    model=MODEL,
    instructions=(
        "Coordinate the AV safety review pipeline: perception, then risk audit, then maneuver "
        "planning, then policy. Carry the relevant context forward at each stage."
    ),
    agents=[perception, auditor, planner, policy],
    strategy=Strategy.SEQUENTIAL,
    memory=ConversationMemory(max_messages=50),
    max_turns=80,
)

DEFAULT_GOAL = (
    "Run a full AV safety review across all demo scenarios: perceive the agents, audit collision "
    "risk, plan maneuvers, then draft and (with approval) deploy policy for the worst scenarios."
)


def _drive_with_hitl(handle, deadline_seconds: float = 300.0):
    """Drive a human-in-the-loop run by polling status (the supported way).

    Watches handle.get_status(): when is_waiting + pending_tool, approve/reject the
    sensitive action (auto unless AGENTSPAN_AUTO_APPROVE=0), and loop until complete.
    In production you'd approve from the dashboard / `agentspan agent respond` instead.
    """
    acted: set[str] = set()
    deadline = time.monotonic() + deadline_seconds
    while time.monotonic() < deadline:
        try:
            st = handle.get_status()
        except Exception as e:
            print(yellow(f"   status error: {e}"))
            break
        status = str(getattr(st, "status", "") or "").upper()
        if getattr(st, "is_complete", False) or status in ("COMPLETED", "FAILED", "TERMINATED", "TIMED_OUT"):
            break
        pending = getattr(st, "pending_tool", None)
        if getattr(st, "is_waiting", False) and pending:
            key = str(pending)
            if key in acted:
                time.sleep(0.4)
                continue
            acted.add(key)
            name = pending.get("name") or pending.get("tool") or "sensitive action"
            args = pending.get("args") or pending.get("arguments") or {}
            print(yellow(f"   ⏸ approval required: {name}  {args}"))
            try:
                if AUTO_APPROVE:
                    handle.approve()
                    print(green("     ✓ auto-approved (AGENTSPAN_AUTO_APPROVE=1)"))
                elif input("     approve this sensitive action? [y/N] ").strip().lower() == "y":
                    handle.approve()
                    print(green("     ✓ approved"))
                else:
                    handle.reject("operator denied")
                    print(red("     ✗ rejected"))
            except Exception as e:
                print(yellow(f"     approval call failed: {e}"))
        else:
            time.sleep(0.4)
    return handle.join(timeout=30)


def main() -> None:
    if "--plan" in sys.argv:
        try:
            from agentspan.agents import plan
        except ImportError:
            print("plan() is not available in this agentspan version.")
            return
        print(bold("\nCompiled plan for overflow-av-safety-fleet (dry run, no LLM):\n"))
        plan(fleet)
        return

    goal = " ".join(a for a in sys.argv[1:] if a != "--plan") or DEFAULT_GOAL
    server = os.environ.get("AGENTSPAN_SERVER_URL") or "http://localhost:6767"
    api_key = os.environ.get("AGENTSPAN_API_KEY") or None
    api_secret = os.environ.get("AGENTSPAN_API_SECRET") or None

    print(bold("\n╔════════════════════════════════════════════════════════════╗"))
    print(bold("║  Overflow AV-Safety Fleet — durable pipeline via AgentSpan ║"))
    print(bold("╚════════════════════════════════════════════════════════════╝"))
    print(f"{dim('agents  ')} perception » auditor » planner » policy  (SEQUENTIAL)")
    print(f"{dim('features')} structured-output · guardrails · memory · human-approval")
    print(f"{dim('model   ')} {MODEL}    {dim('approval')} {'on' if T.HITL else 'off'}    "
          f"{dim('mode')} {'auto-approve' if AUTO_APPROVE else 'interactive'}")
    print(f"{dim('server  ')} {server}\n")

    try:
        with AgentRuntime(server_url=server, api_key=api_key, api_secret=api_secret) as rt:
            if T.HITL:
                handle = rt.start(fleet, goal)
                eid = getattr(handle, "execution_id", None)
                if eid:
                    print(dim(f"   execution_id {eid}  (polling for approval checkpoints)\n"))
                result = _drive_with_hitl(handle)
            else:
                result = rt.run(fleet, goal)
            print()
            result.print_result()
            print(f"\n{dim('status      ')} {result.status}")
            print(f"{dim('execution_id')} {result.execution_id}")
            print(dim("\nInspect it:  agentspan tui     (or)  agentspan agent execution --since 1h\n"))
    except Exception as e:
        print(yellow(f"\nFleet failed: {e}\n"))
        print(dim("Runtime auto-starts locally; ensure an LLM key is in server/.env or .env."))
        sys.exit(1)


if __name__ == "__main__":
    main()
