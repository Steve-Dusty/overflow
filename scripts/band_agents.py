#!/usr/bin/env python3
"""
Overflow on Band — LLM-driven AV-safety agents that discover & coordinate.

ArmorIQ governs the agents and AgentSpan makes them durable; Band is the layer that
lets them **find each other and coordinate with no hard-coded orchestrator**. Each
role registers on Band with a plain-English description; the agent is a real LLM that,
given the conversation, *decides* what to do and which peer to @mention next — Band
routes by description, not by wiring.

Each role is a Band "remote agent": we subclass Band's SimpleAdapter and override
on_message() to run an LLM (OpenAI, reusing overflow's key from server/.env) with the
role's brief, the shared AV scene data, and the live conversation history.

    npm run band -- auditor              # connect the safety auditor to Band
    npm run band -- auditor --selftest   # run the LLM agent locally, no connection

Setup: BAND_API_KEY (band_u_...) in .env, plus one "Remote Agent" per role created in
the Band dashboard (app.band.ai) with each UUID pasted into band_agent_config.yaml.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import agentspan_tools as T  # shared AV-safety domain data + .env loader (sets OPENAI_API_KEY)

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / "band_agent_config.yaml"
CONFIG_EXAMPLE = ROOT / "band_agent_config.example.yaml"

# OpenAI model (strip any "provider/" prefix from AGENTSPAN_MODEL); overflow has the key in server/.env.
MODEL = (os.environ.get("AGENTSPAN_MODEL") or "gpt-4o-mini").split("/")[-1]

# --------------------------------------------------------------------------- #
# roles — description drives Band discovery; instructions steer the LLM
# --------------------------------------------------------------------------- #
ROLES: dict[str, dict] = {
    "overflow-perception-agent": {
        "description": "Detects and classifies road agents (vehicles, pedestrians, cyclists) in Overflow AV scenes.",
        "instructions": "Summarize the agents present per scene, then hand off to the safety auditor to score risk.",
    },
    "overflow-safety-auditor": {
        "description": "Audits Overflow driving scenarios and scores collision risk; flags critical incidents.",
        "instructions": "Score collision risk per scenario; flag any with risk > 0.75 as critical and hand those to the planner.",
    },
    "overflow-planner-agent": {
        "description": "Plans safe ego maneuvers for high-risk autonomous-vehicle incidents.",
        "instructions": "For each high-risk scenario, propose a concrete safe maneuver, then hand off to the policy agent.",
    },
    "overflow-policy-agent": {
        "description": "Drafts and (with approval) deploys driving-policy updates for risky AV scenarios.",
        "instructions": "Draft policy updates for the worst scenarios. Deploying is sensitive and needs human approval. Never recommend disabling safety.",
    },
    "overflow-fleet-coordinator": {
        "description": "Orchestrates the Overflow AV safety-review fleet and delegates to specialist agents.",
        "instructions": "Kick off and sequence the review: ask perception to start, then ensure audit, planning, and policy each happen.",
    },
}

ALIASES = {
    "perception": "overflow-perception-agent",
    "auditor": "overflow-safety-auditor",
    "planner": "overflow-planner-agent",
    "policy": "overflow-policy-agent",
    "coordinator": "overflow-fleet-coordinator",
}

# deterministic next-hop, used only if the LLM is unavailable
_NEXT = {
    "overflow-perception-agent": "overflow-safety-auditor",
    "overflow-safety-auditor": "overflow-planner-agent",
    "overflow-planner-agent": "overflow-policy-agent",
    "overflow-policy-agent": "",
    "overflow-fleet-coordinator": "overflow-perception-agent",
}


def _c(code):
    return lambda s: f"\x1b[{code}m{s}\x1b[0m"


dim, bold, green, yellow, cyan = _c("2"), _c("1"), _c("32"), _c("33"), _c("36")


# --------------------------------------------------------------------------- #
# shared situational data + LLM reasoning
# --------------------------------------------------------------------------- #
def scene_brief() -> str:
    rows = []
    for s in T.all_scenes():
        w = T.worst_incident(s)
        rows.append(
            f"{s.get('scenarioId')}: risk {w['risk'] if w else 0.0} "
            f"({(w or {}).get('type', 'none')}, TTC {(w or {}).get('ttc_seconds', '-')}s)"
        )
    return "Current AV scenes and their worst-incident risk:\n- " + "\n- ".join(rows)


def _peer_directory(exclude: str) -> str:
    return "\n".join(f"- {name}: {meta['description']}" for name, meta in ROLES.items() if name != exclude)


def _system_prompt(role: str) -> str:
    meta = ROLES[role]
    return (
        f"You are the Overflow {role} on the Band agent platform — a network where agents "
        f"discover each other and coordinate with NO central orchestrator.\n"
        f"Your job: {meta['description']}\n"
        f"{meta['instructions']}\n\n"
        f"You hand work off by @mentioning a peer by their EXACT name. Peers on the Band:\n"
        f"{_peer_directory(role)}\n\n"
        f"{scene_brief()}\n\n"
        f"Reply concisely (3-6 lines). When your part is done and another agent should act "
        f"next, @mention them explicitly and state what you need from them."
    )


def _fallback(role: str) -> str:
    nxt = _NEXT.get(role, "")
    return scene_brief() + (f"\n\n@{nxt} — your turn." if nxt else "\n\n(Review complete.)")


def llm_reply(role: str, incoming: str, history: list[dict] | None = None) -> str:
    """Run the role's LLM agent over the conversation; it decides the reply + any @mention."""
    msgs = [{"role": "system", "content": _system_prompt(role)}]
    for h in (history or [])[-8:]:
        content = h.get("content") or ""
        if not content:
            continue
        who = "assistant" if h.get("role") in ("assistant", "agent") else "user"
        msgs.append({"role": who, "content": content})
    msgs.append({"role": "user", "content": incoming or "Begin your part of the AV safety review."})
    try:
        from openai import OpenAI
        resp = OpenAI().chat.completions.create(model=MODEL, messages=msgs, temperature=0.3, max_tokens=350)
        return (resp.choices[0].message.content or "").strip() or _fallback(role)
    except Exception as e:
        return _fallback(role) + f"\n{dim(f'(LLM unavailable: {e})')}"


def _history_to_dicts(history) -> list[dict]:
    """Best-effort conversion of Band's history into [{role, content}] for the LLM."""
    out = []
    for h in history or []:
        if isinstance(h, dict):
            out.append({"role": h.get("role", "user"), "content": h.get("content") or h.get("text") or ""})
        else:
            out.append({"role": getattr(h, "role", "user"), "content": getattr(h, "content", None) or getattr(h, "text", "") or ""})
    return out


def _resolve_role(arg: str) -> str:
    if arg in ROLES:
        return arg
    if arg in ALIASES:
        return ALIASES[arg]
    raise SystemExit(f"unknown role '{arg}'. choose: {', '.join(ALIASES)} (or a full role name)")


def _load_agent_id(role: str) -> str | None:
    path = CONFIG if CONFIG.exists() else CONFIG_EXAMPLE
    if not path.exists():
        return None
    aid = None
    try:
        import yaml
        data = yaml.safe_load(path.read_text()) or {}
        aid = (data.get(role) or {}).get("agent_id")
    except Exception:
        cur = None
        for line in path.read_text().splitlines():
            if line and not line[0].isspace() and line.rstrip().endswith(":"):
                cur = line.strip()[:-1]
            elif cur == role and "agent_id:" in line:
                aid = line.split("agent_id:", 1)[1].strip().strip('"').strip("'")
                break
    if not aid or "REPLACE" in str(aid):
        return None
    return aid


def selftest(role: str) -> None:
    print(bold(f"\nBand role '{role}' — LLM self-test (no connection)\n"))
    print(dim(f"discoverable as: {ROLES[role]['description']}"))
    print(dim(f"model: {MODEL}\n"))
    incoming = "The previous stage is done — please do your part of the AV safety review and hand off."
    print(cyan(f"◀ incoming: {incoming}\n"))
    print(llm_reply(role, incoming))
    print(green("\n✓ the agent reasoned over the real scene data and chose its own reply/@mention"))


def connect(role: str) -> None:
    from band import Agent, Emit
    from band.core import SimpleAdapter

    api_key = os.environ.get("BAND_API_KEY", "")
    agent_id = _load_agent_id(role)

    print(bold("\n╔════════════════════════════════════════════════════════════╗"))
    print(bold("║  Overflow on Band — LLM-driven, discoverable AV agents     ║"))
    print(bold("╚════════════════════════════════════════════════════════════╝"))
    print(f"{dim('role   ')} {role}")
    print(f"{dim('desc   ')} {ROLES[role]['description']}")
    print(f"{dim('model  ')} {MODEL}")
    print(f"{dim('key    ')} {'band_u_… (set)' if api_key.startswith('band_') else yellow('BAND_API_KEY not set')}")
    print(f"{dim('agent  ')} {agent_id or yellow('no UUID — register this role in the Band dashboard')}\n")

    if not api_key or not agent_id:
        print(yellow("Not enough to connect yet — running the LLM agent locally instead:\n"))
        selftest(role)
        print(dim("\nTo go live: set BAND_API_KEY in .env, create a Remote Agent per role in the"))
        print(dim("Band dashboard, and paste each UUID into band_agent_config.yaml."))
        return

    class AVSafetyAdapter(SimpleAdapter):
        SUPPORTED_EMIT = frozenset({Emit.EXECUTION})
        SUPPORTED_CAPABILITIES = frozenset()

        async def on_started(self, agent_name: str, agent_description: str) -> None:
            print(green(f"● {agent_name} connected to Band — discoverable as: {agent_description}"))

        async def on_message(self, msg, tools, history, participants_msg, contacts_msg,
                             *, is_session_bootstrap: bool, room_id: str) -> None:
            if is_session_bootstrap:
                return
            text = getattr(msg, "text", None) or getattr(msg, "content", "") or ""
            print(cyan(f"◀ room {room_id}: {str(text)[:80]}"))
            reply = llm_reply(role, str(text), _history_to_dicts(history))  # LLM decides reply + @mention
            try:
                await tools.send_message(reply)
                print(green("▶ replied" + (" (with @mention)" if "@overflow-" in reply else "")))
            except Exception as e:
                print(yellow(f"send_message failed: {e}"))

    adapter = AVSafetyAdapter()
    adapter.agent_description = ROLES[role]["description"]
    agent = Agent.create(adapter=adapter, agent_id=agent_id, api_key=api_key)
    print(dim("connecting to Band… (Ctrl-C to stop)\n"))
    try:
        agent.run()
    except KeyboardInterrupt:
        print(dim("\nstopped."))
    except Exception as e:
        print(yellow(f"\nBand connection failed: {e}"))
        print(dim("Check BAND_API_KEY + the agent UUID. Running the LLM agent locally instead:\n"))
        selftest(role)


def main() -> None:
    args = sys.argv[1:]
    if not args:
        print("usage: band_agents.py <role> [--selftest]")
        print("roles:", ", ".join(ALIASES), "(or full role names)")
        return
    role = _resolve_role(args[0])
    if "--selftest" in args:
        selftest(role)
    else:
        connect(role)


if __name__ == "__main__":
    main()
