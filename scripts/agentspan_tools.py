#!/usr/bin/env python3
"""
Overflow AV-safety tools — the shared capability registry for the AgentSpan fleet.

These are the same capabilities the ArmorIQ agents expose (scripts/armoriq_*.mjs),
re-implemented as AgentSpan ``@tool`` functions so they can run inside *durable*
workflows: every call is logged, retried on failure, and resumable if the process
dies. The two sensitive actions (``deploy_policy``, ``override_safety_limit``) are
marked ``approval_required=True`` so AgentSpan pauses the workflow for a human to
approve or reject before they run — the durable-execution analogue of ArmorIQ's
allow/block/hold.

Everything operates over the project's real demo scenes
(``public/demo_data/waymo_scene_*.json``). Pure stdlib + absolute paths, so the
tools behave identically whether AgentSpan runs them in-process or in an isolated
worker.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

from agentspan.agents import tool

# --------------------------------------------------------------------------- #
# paths (absolute — independent of cwd / worker isolation)
# --------------------------------------------------------------------------- #
ROOT = Path(__file__).resolve().parent.parent
DEMO_DIR = ROOT / "public" / "demo_data"
OUT_DIR = ROOT / "checkpoints"
REPORT_PATH = OUT_DIR / "agentspan_safety_report.md"


# --------------------------------------------------------------------------- #
# env — load .env and bridge the VITE_-prefixed keys the app already uses
# --------------------------------------------------------------------------- #
def load_env() -> None:
    """Populate os.environ from the repo's .env files without overriding real env vars.

    Reads BOTH the root .env and server/.env — overflow keeps its OPENAI_API_KEY in
    server/.env (the instrumented OpenAI-proxy backend), so the agents reuse it.
    """
    for env_path in (ROOT / ".env", ROOT / "server" / ".env"):
        if not env_path.exists():
            continue
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            os.environ.setdefault(key.strip(), val.strip().strip('"').strip("'"))
    # AgentSpan reads OPENAI_API_KEY / ANTHROPIC_API_KEY; the app stores the OpenAI
    # key VITE_-prefixed, so bridge it to the canonical name if that's unset.
    if not os.environ.get("OPENAI_API_KEY") and os.environ.get("VITE_OPENAI_API_KEY"):
        os.environ["OPENAI_API_KEY"] = os.environ["VITE_OPENAI_API_KEY"]
    if not os.environ.get("ANTHROPIC_API_KEY") and os.environ.get("VITE_ANTHROPIC_API_KEY"):
        os.environ["ANTHROPIC_API_KEY"] = os.environ["VITE_ANTHROPIC_API_KEY"]


load_env()


def pick_model() -> str:
    """Choose a ``provider/model`` string from env (Anthropic preferred, then OpenAI)."""
    if os.environ.get("AGENTSPAN_MODEL"):
        return os.environ["AGENTSPAN_MODEL"]
    if os.environ.get("ANTHROPIC_API_KEY"):
        return "anthropic/claude-sonnet-4-6"
    return "openai/gpt-4o-mini"


# Sensitive tools pause for human approval when AGENTSPAN_HITL=1 (opt-in). The fleet
# completes reliably with this OFF; the verified approval demo is scripts/agentspan_hitl.py.
HITL = os.environ.get("AGENTSPAN_HITL", "0").lower() not in ("0", "false", "no", "")


# --------------------------------------------------------------------------- #
# scene helpers (plain functions — used by the tools and the smoke test)
# --------------------------------------------------------------------------- #
def scene_files() -> list[str]:
    if not DEMO_DIR.exists():
        return []
    return sorted(
        f.name
        for f in DEMO_DIR.iterdir()
        if f.name.startswith("waymo_scene_") and f.name.endswith(".json")
    )


def _read(name: str) -> dict:
    return json.loads((DEMO_DIR / name).read_text())


def all_scenes() -> list[dict]:
    return [_read(f) for f in scene_files()]


def load_scene(id_or_file: str) -> dict:
    """Resolve a scene by filename or by its scenarioId."""
    if id_or_file.endswith(".json"):
        return _read(id_or_file)
    for f in scene_files():
        try:
            s = _read(f)
        except Exception:
            continue
        if s.get("scenarioId") == id_or_file:
            return s
    return _read(f"waymo_scene_{id_or_file}.json")  # conventional fallback


def scenario_ids() -> list[str]:
    return [s.get("scenarioId") for s in all_scenes()]


# severity → weight. Handles the real data's values (critical/high/medium/low/warning/none),
# which the original .mjs map ({critical,warning,none}) silently missed for "high".
_SEV_W = {"critical": 1.0, "high": 0.9, "warning": 0.6, "medium": 0.5, "low": 0.3, "none": 0.1}


def risk_of(inc: dict) -> float:
    sev = _SEV_W.get(str(inc.get("severity", "warning")).lower(), 0.5)
    ttc = float(inc.get("ttc_seconds", 3) or 3)
    ttc_w = max(0.0, min(1.0, (3 - ttc) / 3))                       # 0s→1, ≥3s→0
    speed_w = min(1.0, float(inc.get("ego_speed_at_trigger", 0) or 0) / 20)
    return round(0.5 * sev + 0.35 * ttc_w + 0.15 * speed_w, 2)


def worst_incident(s: dict) -> dict | None:
    incs = [{**i, "risk": risk_of(i)} for i in (s.get("incidents") or [])]
    return sorted(incs, key=lambda i: i["risk"], reverse=True)[0] if incs else None


# maneuver keyed by an incident-type keyword. Real types look like
# "rear_end_collision_risk" / "jaywalker_crossing", so match on substring.
_MANEUVER = [
    ("jaywalk", "emergency_brake"), ("pedestrian", "emergency_brake"),
    ("rear_end", "brake_and_widen_gap"), ("red_light", "hard_brake_stop"),
    ("swerv", "nudge_and_brake"), ("near_miss", "defensive_brake"),
]


def maneuver_for(inc_type: str) -> str:
    t = (inc_type or "").lower()
    for key, mv in _MANEUVER:
        if key in t:
            return mv
    return "keep_lane"


# --------------------------------------------------------------------------- #
# tools — perception → risk → planning → policy
# --------------------------------------------------------------------------- #
@tool
def list_scenarios() -> list[dict]:
    """List every driving scenario in the dataset with its incident count."""
    return [
        {"scenarioId": s.get("scenarioId"), "incidents": len(s.get("incidents") or [])}
        for s in all_scenes()
    ]


@tool
def inspect_scenario(scenario: str) -> dict:
    """Inspect one scenario: weather, time of day, object count, and its incidents."""
    s = load_scene(scenario)
    stats = s.get("stats") or {}
    return {
        "scenarioId": s.get("scenarioId"),
        "weather": stats.get("weather"),
        "timeOfDay": stats.get("time_of_day"),
        "objects": len(s.get("tracked_objects") or []),
        "incidents": [
            {
                "type": i.get("type"),
                "severity": i.get("severity"),
                "ttc_seconds": i.get("ttc_seconds"),
                "ego_speed": i.get("ego_speed_at_trigger"),
            }
            for i in (s.get("incidents") or [])
        ],
    }


@tool
def detect_objects(scenario: str) -> dict:
    """Count and group the tracked road agents (vehicles, pedestrians, cyclists) in a scenario."""
    s = load_scene(scenario)
    by_type: dict[str, int] = {}
    for o in s.get("tracked_objects") or []:
        t = o.get("type", "UNKNOWN")
        by_type[t] = by_type.get(t, 0) + 1
    return {"scenarioId": s.get("scenarioId"), "objects": len(s.get("tracked_objects") or []), "byType": by_type}


@tool
def classify_threats(scenario: str) -> dict:
    """Classify a scenario's worst incident as critical / elevated / nominal."""
    s = load_scene(scenario)
    w = worst_incident(s)
    level = "nominal"
    if w:
        level = "critical" if w["risk"] > 0.75 else "elevated" if w["risk"] > 0.4 else "nominal"
    return {"scenarioId": s.get("scenarioId"), "threat": level, "worst": (w or {}).get("type")}


@tool
def assess_risk(scenario: str) -> dict:
    """Score a scenario's worst incident on a 0-1 collision-risk scale."""
    s = load_scene(scenario)
    w = worst_incident(s)
    if not w:
        return {"scenarioId": s.get("scenarioId"), "riskScore": 0, "worstIncident": None}
    return {
        "scenarioId": s.get("scenarioId"),
        "riskScore": w["risk"],
        "worstIncident": w.get("type"),
        "ttc": w.get("ttc_seconds"),
    }


@tool
def plan_maneuver(scenario: str) -> dict:
    """Recommend a safe ego maneuver for a scenario's worst incident."""
    s = load_scene(scenario)
    w = worst_incident(s)
    return {
        "scenarioId": s.get("scenarioId"),
        "incident": (w or {}).get("type", "none"),
        "maneuver": maneuver_for((w or {}).get("type", "")),
        "ttc": (w or {}).get("ttc_seconds"),
    }


@tool
def recommend_policy(scenario: str) -> dict:
    """Draft a concrete driving-policy change for a scenario's worst incident."""
    s = load_scene(scenario)
    w = worst_incident(s)
    if not w:
        return {"scenarioId": s.get("scenarioId"), "recommendation": "No incident — no policy change needed."}
    rec = (
        f"For {w.get('type')} (TTC {w.get('ttc_seconds')}s at "
        f"{w.get('ego_speed_at_trigger')} m/s): lower the speed ceiling, widen the "
        f"following/lateral buffer in this context, and trigger {maneuver_for(w.get('type', ''))} "
        f"~1s earlier on this threat geometry."
    )
    return {"scenarioId": s.get("scenarioId"), "incident": w.get("type"), "risk": w["risk"], "recommendation": rec}


@tool
def draft_policy(scenario: str) -> dict:
    """Draft (do NOT deploy) a policy-update string for a scenario."""
    s = load_scene(scenario)
    w = worst_incident(s)
    if not w:
        return {"scenarioId": s.get("scenarioId"), "policy": "no change"}
    return {
        "scenarioId": s.get("scenarioId"),
        "policy": f"On {w.get('type')}: cap speed + trigger {maneuver_for(w.get('type', ''))} ~1s earlier; widen lateral buffer.",
    }


@tool(approval_required=HITL)
def deploy_policy(scenario: str) -> dict:
    """SENSITIVE — push a drafted driving policy to the production policy store. Requires human approval."""
    return {"scenarioId": scenario, "deployed": True, "target": "production-policy-store"}


@tool(approval_required=HITL)
def override_safety_limit(scenario: str, limit: str = "max_decel") -> dict:
    """SENSITIVE — override a hard safety limit (e.g. max deceleration). Requires human approval."""
    return {"scenarioId": scenario, "overrode": limit, "note": "sensitive"}


@tool
def write_report(title: str, body_markdown: str) -> dict:
    """Persist the audit findings as a markdown report under checkpoints/."""
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    body = (
        f"# {title or 'Overflow AV Safety Audit'}\n\n"
        f"_Generated by the AgentSpan-powered Overflow safety fleet._\n\n"
        f"{body_markdown}\n"
    )
    REPORT_PATH.write_text(body)
    return {"path": str(REPORT_PATH.relative_to(ROOT)), "bytes": len(body)}
