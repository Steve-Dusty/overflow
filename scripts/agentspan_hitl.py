#!/usr/bin/env python3
"""
AgentSpan human-in-the-loop demo — a sensitive action that pauses for approval.

This is the *verified* HITL flow: the agent calls an ``approval_required`` tool →
AgentSpan pauses the durable execution (status.is_waiting + pending_tool carrying an
approval schema) → we poll status and call approve()/reject() → it resumes.

(The full fleet uses nested sub-workflows whose approval pauses aren't surfaced on the
parent handle, so HITL there is best driven from the AgentSpan dashboard / `agentspan
agent respond`. This single-agent demo shows the loop end-to-end, in code.)

    npm run agentspan:hitl                            # auto-approve
    npm run agentspan:hitl -- red_light_runner        # pick a scenario
    AGENTSPAN_AUTO_APPROVE=0 npm run agentspan:hitl    # prompt y/N
"""
from __future__ import annotations

import os
import sys
import time

from agentspan.agents import Agent, AgentRuntime, tool

import agentspan_tools as T  # pick_model() + loads OPENAI_API_KEY from server/.env

AUTO_APPROVE = os.environ.get("AGENTSPAN_AUTO_APPROVE", "1").lower() not in ("0", "false", "no", "")


@tool(approval_required=True)
def deploy_policy(scenario: str) -> dict:
    """SENSITIVE — deploy a driving policy to production. Requires human approval."""
    return {"scenario": scenario, "deployed": True, "target": "production-policy-store"}


agent = Agent(
    name="overflow-policy-approver",
    model=T.pick_model(),
    instructions="Call deploy_policy once for the scenario named in the prompt, then confirm in one line.",
    tools=[deploy_policy],
    max_turns=5,
)


def _c(code):
    return lambda s: f"\x1b[{code}m{s}\x1b[0m"


dim, bold, green, red, yellow = _c("2"), _c("1"), _c("32"), _c("31"), _c("33")


def main() -> None:
    scenario = " ".join(sys.argv[1:]) or "jaywalker"
    server = os.environ.get("AGENTSPAN_SERVER_URL") or "http://localhost:6767"

    print(bold("\n╔════════════════════════════════════════════════════════════╗"))
    print(bold("║  AgentSpan HITL — deploying policy requires human approval  ║"))
    print(bold("╚════════════════════════════════════════════════════════════╝"))
    print(f"{dim('scenario')} {scenario}    {dim('mode')} {'auto-approve' if AUTO_APPROVE else 'interactive'}\n")

    try:
        with AgentRuntime(server_url=server) as rt:
            handle = rt.start(agent, f"Deploy the driving policy for scenario '{scenario}'.")
            print(dim(f"execution_id {handle.execution_id}  — running until it needs approval…\n"))
            deadline = time.monotonic() + 120
            acted: set[str] = set()
            while time.monotonic() < deadline:
                st = handle.get_status()
                if st.is_complete or str(st.status).upper() in ("COMPLETED", "FAILED", "TERMINATED", "TIMED_OUT"):
                    break
                if st.is_waiting and st.pending_tool and str(st.pending_tool) not in acted:
                    acted.add(str(st.pending_tool))
                    print(yellow("⏸ approval required — agent wants to run a SENSITIVE action (deploy_policy)"))
                    if AUTO_APPROVE:
                        handle.approve()
                        print(green("  ✓ auto-approved\n"))
                    elif input("  approve this deployment? [y/N] ").strip().lower() == "y":
                        handle.approve()
                        print(green("  ✓ approved\n"))
                    else:
                        handle.reject("operator denied")
                        print(red("  ✗ rejected\n"))
                time.sleep(1)
            result = handle.join(timeout=30)
            result.print_result()
            print(f"\n{dim('status')} {result.status}   {dim('finish')} {result.finish_reason}\n")
    except Exception as e:
        print(yellow(f"\nHITL demo failed: {e}"))
        print(dim("Runtime auto-starts locally; ensure an LLM key is in server/.env."))
        sys.exit(1)


if __name__ == "__main__":
    main()
