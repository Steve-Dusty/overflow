#!/usr/bin/env python3
"""
Deterministic smoke test for the AgentSpan integration — no LLM, no server.

Verifies (a) the tools read the real demo data and (b) the agent wires up and runs
through a scripted tool sequence via AgentSpan's ``mock_run``. Run it before starting
the runtime:

    npm run agentspan:test
"""
from __future__ import annotations

import json

from agentspan.agents.testing import MockEvent, expect, mock_run

import agentspan_tools as T
from agentspan_agent import agent


def test_tools_read_real_data() -> None:
    ids = T.scenario_ids()
    assert ids, "expected demo scenarios in public/demo_data/waymo_scene_*.json"
    # risk_of must handle the real severity values (e.g. "high"), not just critical/warning.
    r = T.risk_of({"severity": "high", "ttc_seconds": 1.2, "ego_speed_at_trigger": 10.5})
    assert 0.0 < r <= 1.0, f"risk_of returned {r}"
    print(f"  data ok — {len(ids)} scenarios: {ids}")
    print(f"  risk_of(high/1.2s/10.5) = {r}")


def test_agent_mock_run() -> None:
    result = mock_run(
        agent,
        "Audit the scenarios and write a report.",
        events=[
            MockEvent.tool_call("list_scenarios", {}),
            MockEvent.tool_result("list_scenarios", json.dumps([{"scenarioId": "jaywalker"}])),
            MockEvent.tool_call("assess_risk", {"scenario": "jaywalker"}),
            MockEvent.tool_result("assess_risk", json.dumps({"riskScore": 0.9})),
            MockEvent.tool_call("write_report", {"title": "Audit", "body_markdown": "ok"}),
            MockEvent.done("Audit complete."),
        ],
    )
    expect(result).completed()
    expect(result).used_tool("list_scenarios")
    expect(result).used_tool("assess_risk")
    print("  mock_run ok — completed, used list_scenarios + assess_risk")


if __name__ == "__main__":
    print("AgentSpan integration smoke test\n")
    test_tools_read_real_data()
    test_agent_mock_run()
    print("\n✓ all checks passed")
