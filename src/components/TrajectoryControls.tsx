/**
 * TrajectoryControls — Floating glass panel for trajectory visualization controls.
 * Shows: moment navigation, planner/observer policy toggles, score info, auto-play.
 * Positioned bottom-left (or top-right of the 3D scene).
 */

import { useEffect, useRef } from "react";
import { useStore } from "../store";
import { colors, fonts } from "../theme";
import type { PlannerPolicy, ObserverPolicy } from "../utils/trajectoryData";
import { getPlannerChoice, getObserverChoice, CANDIDATE_COLORS } from "../utils/trajectoryData";

export default function TrajectoryControls() {
  const moments = useStore((s) => s.trajectoryMoments);
  const momentIndex = useStore((s) => s.currentMomentIndex);
  const plannerPolicy = useStore((s) => s.plannerPolicy);
  const observerPolicy = useStore((s) => s.observerPolicy);
  const showTrajectories = useStore((s) => s.showTrajectories);
  const autoPlay = useStore((s) => s.autoPlayMoments);
  const actions = useStore((s) => s.actions);

  // Auto-play moments at 2 fps
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (autoPlay && moments.length > 0) {
      intervalRef.current = setInterval(() => actions.nextMoment(), 500);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [autoPlay, moments.length, actions]);

  if (moments.length === 0) return null;

  const moment = moments[momentIndex];
  if (!moment) return null;

  const plannerChoice = getPlannerChoice(moment, plannerPolicy);
  const observerChoice = getObserverChoice(moment, observerPolicy, plannerChoice);
  const plannerScore = moment.candidates[plannerChoice]?.score ?? 0;
  const observerScore = moment.candidates[observerChoice]?.score ?? 0;
  const deltaScore = observerScore - plannerScore;

  return (
    <div style={{
      position: "absolute",
      top: 360, right: 8,
      width: 240,
      background: "rgba(12,15,26,0.82)",
      backdropFilter: "blur(20px)",
      border: "1px solid rgba(255,255,255,0.06)",
      borderRadius: 10,
      padding: "10px 0",
      fontFamily: fonts.sans,
      userSelect: "none",
      zIndex: 15,
      display: "flex",
      flexDirection: "column",
      gap: 2,
    }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 12px 6px",
        borderBottom: "1px solid rgba(255,255,255,0.04)",
      }}>
        <span style={{
          fontSize: 8, fontWeight: 700, color: colors.textDim,
          letterSpacing: "1.2px", textTransform: "uppercase",
          fontFamily: fonts.mono,
        }}>
          🛤 Trajectory E2E
        </span>
        <button onClick={() => actions.toggleTrajectories()} style={{
          background: showTrajectories ? "rgba(0,232,157,0.15)" : "rgba(255,255,255,0.04)",
          border: `1px solid ${showTrajectories ? "rgba(0,232,157,0.3)" : "rgba(255,255,255,0.06)"}`,
          borderRadius: 4, padding: "2px 8px", fontSize: 8, cursor: "pointer",
          color: showTrajectories ? colors.accent : colors.textDim,
          fontFamily: fonts.mono, fontWeight: 600,
        }}>
          {showTrajectories ? "ON" : "OFF"}
        </button>
      </div>

      {/* Moment navigation */}
      <Label text="Moment" />
      <div style={{
        display: "flex", alignItems: "center", gap: 4, padding: "0 10px",
      }}>
        <NavButton label="◀" onClick={() => actions.prevMoment()} />
        <div style={{
          flex: 1, textAlign: "center",
          fontSize: 11, fontWeight: 600, fontFamily: fonts.mono,
          color: colors.textPrimary,
        }}>
          {momentIndex + 1} / {moments.length}
        </div>
        <NavButton label="▶" onClick={() => actions.nextMoment()} />
        <button onClick={() => actions.toggleAutoPlayMoments()} style={{
          background: autoPlay ? "rgba(0,200,219,0.15)" : "rgba(255,255,255,0.04)",
          border: `1px solid ${autoPlay ? "rgba(0,200,219,0.3)" : "rgba(255,255,255,0.06)"}`,
          borderRadius: 4, padding: "3px 6px", fontSize: 8, cursor: "pointer",
          color: autoPlay ? colors.accentBlue : colors.textDim,
          fontFamily: fonts.mono,
        }}>
          {autoPlay ? "⏸" : "▶"}
        </button>
      </div>

      {/* Moment ID + frame */}
      <div style={{ padding: "2px 12px", fontSize: 8, fontFamily: fonts.mono, color: colors.textDim }}>
        ID: {moment.id} · Frame {moment.frameIndex}
      </div>

      <Sep />

      {/* Candidate scores */}
      <Label text="Candidates" />
      <div style={{ padding: "0 10px", display: "flex", flexDirection: "column", gap: 3 }}>
        {moment.candidates.map((c, idx) => {
          const isPlannerPick = idx === plannerChoice;
          const isObserverPick = idx === observerChoice;
          const candColor = CANDIDATE_COLORS[idx % CANDIDATE_COLORS.length];
          return (
            <div key={idx} style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "3px 6px", borderRadius: 4,
              background: (isPlannerPick || isObserverPick)
                ? "rgba(255,255,255,0.04)" : "transparent",
            }}>
              <span style={{
                width: 8, height: 8, borderRadius: "50%",
                background: candColor,
                border: isPlannerPick ? "2px solid #FF4444" : isObserverPick ? "2px solid #00E89D" : "none",
                boxShadow: isPlannerPick ? "0 0 6px #FF4444" : isObserverPick ? "0 0 6px #00E89D" : "none",
                flexShrink: 0,
              }} />
              <span style={{ flex: 1, fontSize: 9, color: colors.textSecondary }}>{c.label}</span>
              <span style={{ fontSize: 10, fontWeight: 700, fontFamily: fonts.mono, color: candColor }}>
                {c.score.toFixed(1)}
              </span>
              {isPlannerPick && (
                <span style={{
                  fontSize: 6, fontWeight: 700, color: "#FF4444",
                  background: "rgba(255,68,68,0.15)", padding: "1px 3px", borderRadius: 2,
                }}>P</span>
              )}
              {isObserverPick && (
                <span style={{
                  fontSize: 6, fontWeight: 700, color: "#00E89D",
                  background: "rgba(0,232,157,0.15)", padding: "1px 3px", borderRadius: 2,
                }}>O</span>
              )}
            </div>
          );
        })}
      </div>

      <Sep />

      {/* Planner policy */}
      <Label text="Planner (baseline)" />
      <PolicyPills<PlannerPolicy>
        options={[
          { value: "worst", label: "Worst" },
          { value: "random", label: "Random" },
          { value: "best", label: "Best" },
        ]}
        value={plannerPolicy}
        onChange={(v) => actions.setPlannerPolicy(v)}
        accentColor="#FF4444"
      />

      {/* Observer policy */}
      <Label text="Observer (ours)" />
      <PolicyPills<ObserverPolicy>
        options={[
          { value: "best", label: "Oracle" },
          { value: "heuristic", label: "Heuristic" },
          { value: "mimic_planner", label: "Mimic" },
        ]}
        value={observerPolicy}
        onChange={(v) => actions.setObserverPolicy(v)}
        accentColor="#00E89D"
      />

      <Sep />

      {/* Score delta */}
      <div style={{
        padding: "6px 12px",
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <span style={{ fontSize: 8, fontWeight: 700, color: colors.textDim, fontFamily: fonts.mono, textTransform: "uppercase", letterSpacing: "0.8px" }}>
          Δ Score
        </span>
        <span style={{
          fontSize: 16, fontWeight: 800, fontFamily: fonts.mono,
          color: deltaScore > 0 ? "#00E89D" : deltaScore < 0 ? "#FF4444" : colors.textDim,
        }}>
          {deltaScore > 0 ? "+" : ""}{deltaScore.toFixed(1)}
        </span>
      </div>

      {/* Seek to moment frame */}
      <button
        onClick={() => {
          actions.setFrame(moment.frameIndex);
          actions.setPlaying(false);
        }}
        style={{
          margin: "2px 10px 6px",
          padding: "5px 0", fontSize: 9, fontFamily: fonts.mono,
          fontWeight: 600, cursor: "pointer",
          background: "rgba(0,200,219,0.08)",
          color: colors.accentBlue,
          border: `1px solid rgba(0,200,219,0.2)`,
          borderRadius: 5, transition: "all 0.15s",
        }}
      >
        Seek to Frame {moment.frameIndex}
      </button>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────

function Label({ text }: { text: string }) {
  return (
    <div style={{
      fontSize: 8, fontWeight: 700,
      color: colors.textDim,
      letterSpacing: "1.2px",
      textTransform: "uppercase",
      padding: "4px 12px 1px",
    }}>
      {text}
    </div>
  );
}

function Sep() {
  return <div style={{ height: 1, background: "rgba(255,255,255,0.04)", margin: "4px 8px" }} />;
}

function NavButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      width: 28, height: 24, borderRadius: 4, cursor: "pointer",
      border: "1px solid rgba(255,255,255,0.06)",
      background: "rgba(255,255,255,0.04)",
      color: colors.textSecondary, fontSize: 10,
      display: "flex", alignItems: "center", justifyContent: "center",
      transition: "all 0.12s",
    }}>
      {label}
    </button>
  );
}

function PolicyPills<T extends string>({
  options,
  value,
  onChange,
  accentColor,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  accentColor: string;
}) {
  return (
    <div style={{
      display: "flex", gap: 2, margin: "0 8px",
      background: "rgba(255,255,255,0.03)",
      borderRadius: 5, padding: 2,
    }}>
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button key={opt.value} onClick={() => onChange(opt.value)} style={{
            flex: 1, padding: "4px 0", fontSize: 9,
            fontFamily: fonts.sans, fontWeight: active ? 600 : 400,
            border: "none", borderRadius: 4, cursor: "pointer",
            background: active ? `${accentColor}20` : "transparent",
            color: active ? accentColor : colors.textDim,
            transition: "all 0.12s", letterSpacing: "0.3px",
          }}>
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
