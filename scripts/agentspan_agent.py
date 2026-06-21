#!/usr/bin/env python3
"""
Overflow Safety Agent — a *durable* AV-safety auditor powered by AgentSpan.

The ArmorIQ version (scripts/armoriq_agent.mjs) plans tool calls and governs each
one with a signed intent token. This AgentSpan version makes the *execution* itself
durable: the agent compiles into a workflow whose state lives on the AgentSpan
server, so every tool call is logged + retried and the run resumes from the exact
step if the process crashes. Same job — audit the demo scenarios and write a policy
report — now crash-proof and fully replayable from the AgentSpan dashboard / CLI.

    npm run agentspan
    npm run agentspan -- "audit only the critical scenarios and propose fixes"
    npm run agentspan -- --plan       # dry-run: print the compiled plan, no server/LLM

Prereqs: start the runtime once with `npm run agentspan:server`, and set an LLM key
(ANTHROPIC_API_KEY or OPENAI_API_KEY / VITE_OPENAI_API_KEY) in .env.
"""
from __future__ import annotations

import os
import sys

from agentspan.agents import Agent, AgentRuntime

from agentspan_tools import (
    assess_risk,
    inspect_scenario,
    list_scenarios,
    pick_model,
    recommend_policy,
    write_report,
)

MODEL = pick_model()

DEFAULT_GOAL = (
    "Audit every driving scenario for critical incidents, score collision risk, "
    "recommend a policy fix for the highest-risk scenario, and write a markdown report."
)

agent = Agent(
    name="overflow-safety-agent",
    model=MODEL,
    instructions=(
        "You are an autonomous-vehicle safety auditor for the Overflow project. "
        "Use list_scenarios to enumerate the dataset, inspect_scenario and assess_risk to "
        "evaluate each scene, recommend_policy for the highest-risk scenario, and finally "
        "write_report with a concise markdown summary (scenarios audited, the worst scenario, "
        "and the policy recommendation). Be concrete and cite scenarioId, risk scores, and TTC."
    ),
    tools=[list_scenarios, inspect_scenario, assess_risk, recommend_policy, write_report],
    max_turns=40,
)


def _c(code):
    return lambda s: f"\x1b[{code}m{s}\x1b[0m"


dim, bold, green, yellow = _c("2"), _c("1"), _c("32"), _c("33")


def main() -> None:
    if "--plan" in sys.argv:
        try:
            from agentspan.agents import plan
        except ImportError:
            print("plan() is not available in this agentspan version.")
            return
        print(bold("\nCompiled plan for overflow-safety-agent (dry run, no server/LLM):\n"))
        plan(agent)
        return

    goal = " ".join(a for a in sys.argv[1:] if a != "--plan") or DEFAULT_GOAL
    server = os.environ.get("AGENTSPAN_SERVER_URL") or "http://localhost:6767"
    api_key = os.environ.get("AGENTSPAN_API_KEY") or None
    api_secret = os.environ.get("AGENTSPAN_API_SECRET") or None

    print(bold("\n╔════════════════════════════════════════════════════════════╗"))
    print(bold("║  Overflow Safety Agent — durable execution via AgentSpan   ║"))
    print(bold("╚════════════════════════════════════════════════════════════╝"))
    print(f"{dim('goal   ')} {goal}")
    print(f"{dim('model  ')} {MODEL}")
    print(f"{dim('server ')} {server}   {green('● cloud auth') if api_key else dim('○ local (no auth)')}\n")

    try:
        with AgentRuntime(server_url=server, api_key=api_key, api_secret=api_secret) as rt:
            result = rt.run(agent, goal)
            print()
            result.print_result()
            print(f"\n{dim('status      ')} {result.status}")
            print(f"{dim('execution_id')} {result.execution_id}")
            if result.token_usage:
                print(f"{dim('tokens      ')} {result.token_usage.total_tokens}")
            print(dim("\nReplay it:  agentspan agent execution --name overflow-safety-agent --since 1h\n"))
    except Exception as e:
        print(yellow(f"\nRun failed: {e}\n"))
        print(dim("Is the runtime up?  Start it with:  npm run agentspan:server"))
        print(dim("Set an LLM key (ANTHROPIC_API_KEY / OPENAI_API_KEY / VITE_OPENAI_API_KEY) in .env."))
        sys.exit(1)


if __name__ == "__main__":
    main()
