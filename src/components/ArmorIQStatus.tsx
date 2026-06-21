/**
 * ArmorIQStatus — header pill that makes the ArmorIQ integration visible in the
 * running app. It shows governance state (live/idle + mode) and, on click, runs
 * the current scenario's maneuver through ArmorIQ for real — startPlan → enforce
 * via the /api/armoriq proxy — then renders the live verdict + intent-token id.
 *
 * This is the one place ArmorIQ surfaces on-screen; everything else lives in the
 * terminal agents and the external dashboard.
 */

import { useEffect, useState } from "react";
import { ShieldCheck, Shield, ShieldAlert, ShieldX } from "lucide-react";
import { useStore } from "../store";
import { getArmorIQStatus, authorizeManeuver, type ArmorIQVerdict } from "../lib/armoriq";
import { colors, fonts, typeScale } from "../theme";

const AMBER = "#f5b13d";

export default function ArmorIQStatus() {
  const scenarioId = useStore((s) => s.scenarioId);
  const frameIndex = useStore((s) => s.currentFrameIndex);
  const [status, setStatus] = useState<ArmorIQVerdict | null>(null);
  const [busy, setBusy] = useState(false);
  const [verdict, setVerdict] = useState<ArmorIQVerdict | null>(null);

  useEffect(() => {
    let alive = true;
    getArmorIQStatus().then((s) => { if (alive) setStatus(s); });
    return () => { alive = false; };
  }, []);

  // Still probing — render nothing rather than flash a wrong state.
  if (!status) return null;

  const configured = status.configured;

  async function verify() {
    if (busy || !configured) return;
    setBusy(true);
    setVerdict(null);
    const v = await authorizeManeuver({
      action: "brake_hard",
      scenarioId,
      frameIndex,
      egoSpeed: 11,
      nearestObjectDist: 5,
    });
    setVerdict(v);
    setBusy(false);
    window.setTimeout(() => setVerdict(null), 5000);
  }

  // ----- visual state -----
  let dot = configured ? colors.accent : colors.textDim;
  let Icon = configured ? ShieldCheck : Shield;
  let label = configured ? `ArmorIQ · ${status.mode ?? "monitor"}` : "ArmorIQ idle";
  let fg = configured ? colors.textSecondary : colors.textDim;

  if (busy) {
    label = "verifying…";
    dot = AMBER;
  } else if (verdict) {
    if (verdict.decision === "allow") {
      Icon = ShieldCheck; dot = colors.accent; fg = colors.accent;
      label = `verified${verdict.tokenId ? " · " + verdict.tokenId.slice(0, 8) : ""}`;
    } else if (verdict.decision === "block") {
      Icon = ShieldX; dot = colors.error; fg = colors.error; label = "blocked";
    } else if (verdict.decision === "hold") {
      Icon = ShieldAlert; dot = AMBER; fg = AMBER; label = "hold";
    } else {
      Icon = Shield; dot = colors.textDim; fg = colors.textDim; label = "unverified";
    }
  }

  return (
    <div
      onClick={verify}
      title={configured
        ? "ArmorIQ is governing this app — click to run the current maneuver through intent enforcement"
        : "ArmorIQ is idle (set ARMORIQ_API_KEY)"}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px",
        borderRadius: 6,
        background: configured ? "rgba(0,232,157,0.06)" : "rgba(255,255,255,0.03)",
        border: `1px solid ${configured ? "rgba(0,232,157,0.14)" : colors.border}`,
        cursor: configured && !busy ? "pointer" : "default",
        userSelect: "none",
        transition: "all 0.15s ease",
      }}
    >
      <Icon size={13} color={dot} strokeWidth={2} />
      <span style={{ ...typeScale.caption, color: fg, fontFamily: fonts.mono }}>{label}</span>
    </div>
  );
}
