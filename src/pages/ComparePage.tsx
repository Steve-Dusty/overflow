/**
 * ComparePage — RLHF preference collection.
 *
 * Displays a 2x2 grid of trajectory variants for each incident.
 * The human reviewer picks the best response (A / B / C / D).
 * Collected preferences are fed into GRPO training.
 */

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import Scene3D from "../components/Scene3D";
import { useStore } from "../store";
import { loadScenarioVariants } from "../utils/scenarioLoader";
import { VARIANT_INFO, VARIANT_METRICS } from "../mockData";
import type { SceneData, SceneVariant } from "../mockData";
import type { FrameOverrideHolder } from "../components/FrameOverrideContext";
import type { Preference, TrajectoryOption } from "../lib/types";
import { colors, fonts, typeScale, spacing, glass, radius } from "../theme";
import { CheckCircle, ArrowRight, Play, Pause } from "lucide-react";
import type { SceneOffset } from "../components/Scene3D";

// Per-variant offsets to make tiles visually distinct
const VARIANT_OFFSETS: Record<SceneVariant, SceneOffset> = {
  ground_truth:    { dx: 0,  dy: 0,   dYaw: 0 },
  avoid_left:      { dx: 1,  dy: 4,   dYaw: 0.08 },
  avoid_right:     { dx: 1,  dy: -4,  dYaw: -0.08 },
  emergency_brake: { dx: -6, dy: 0,   dYaw: 0 },
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TILE_COLORS = {
  A: "#4ECDC4",
  B: "#FFD93D",
  C: "#FF6B6B",
  D: "#7B68EE",
} as const;

type OptionLetter = keyof typeof TILE_COLORS;

interface OptionDef {
  letter: OptionLetter;
  variant: SceneVariant;
  label: string;
  color: string;
}

const OPTIONS: OptionDef[] = [
  { letter: "A", variant: "ground_truth",    label: "Continue Path",    color: TILE_COLORS.A },
  { letter: "B", variant: "avoid_left",      label: "Swerve Left",     color: TILE_COLORS.B },
  { letter: "C", variant: "avoid_right",     label: "Swerve Right",    color: TILE_COLORS.C },
  { letter: "D", variant: "emergency_brake", label: "Emergency Brake",  color: TILE_COLORS.D },
];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ComparePage() {
  const navigate = useNavigate();
  const incidents = useStore((s) => s.incidents);
  const preferences = useStore((s) => s.preferences);
  const actions = useStore((s) => s.actions);
  const scenarioId = useStore((s) => s.scenarioId);

  const [currentIdx, setCurrentIdx] = useState(0);
  const [variants, setVariants] = useState<Record<SceneVariant, SceneData> | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedLetter, setSelectedLetter] = useState<OptionLetter | null>(null);
  const [allDone, setAllDone] = useState(false);
  const [isPlaying, setIsPlaying] = useState(true);

  const totalIncidents = incidents.length;
  const currentIncident = incidents[currentIdx] ?? null;

  // Load all 4 variants
  useEffect(() => {
    setLoading(true);
    loadScenarioVariants(scenarioId).then((v) => {
      setVariants(v);
      setLoading(false);
    });
  }, [scenarioId]);

  // Handle preference selection
  const handleSelect = useCallback((letter: OptionLetter) => {
    if (selectedLetter || !currentIncident) return;
    setSelectedLetter(letter);

    const opt = OPTIONS.find((o) => o.letter === letter)!;
    const metrics = VARIANT_METRICS[scenarioId][opt.variant];

    const trajectoryOptions: TrajectoryOption[] = OPTIONS.map((o, i) => {
      const m = VARIANT_METRICS[scenarioId][o.variant];
      return {
        id: i,
        label: o.label,
        description: VARIANT_INFO[o.variant].description || o.label,
        action: o.variant,
        color: o.color,
        variant: o.variant,
        reward: m.reward,
        safety: m.safety,
        ttc: m.ttc,
        status: m.status,
      };
    });

    const preference: Preference = {
      id: `pref_${currentIncident.id}_${Date.now()}`,
      incidentId: currentIncident.id,
      scenarioId,
      options: trajectoryOptions,
      selectedOptionId: OPTIONS.findIndex((o) => o.letter === letter),
      timestamp: Date.now(),
    };

    actions.addPreference(preference);

    // Advance after a brief delay
    setTimeout(() => {
      if (currentIdx + 1 >= totalIncidents) {
        setAllDone(true);
      } else {
        setCurrentIdx((prev) => prev + 1);
      }
      setSelectedLetter(null);
    }, 500);
  }, [selectedLetter, currentIncident, currentIdx, totalIncidents, scenarioId, actions]);

  const handleStartTraining = useCallback(() => {
    actions.setPipelineStage("train");
    navigate("/train");
  }, [actions, navigate]);

  // Progress
  const reviewed = allDone ? totalIncidents : currentIdx;
  const progressPct = totalIncidents > 0 ? (reviewed / totalIncidents) * 100 : 0;

  // ── Loading state ──────────────────────────────────────────────────
  if (loading || !variants) {
    return (
      <div style={{
        height: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
        flexDirection: "column", gap: 12, background: colors.bgDeep,
      }}>
        <div style={{
          width: 24, height: 24,
          border: `2px solid ${colors.accent}`,
          borderTopColor: "transparent",
          borderRadius: "50%",
          animation: "cpspin 0.7s linear infinite",
        }} />
        <span style={{ ...typeScale.mono, color: colors.textDim }}>
          Loading scenario variants...
        </span>
        <style>{`@keyframes cpspin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // ── All done state ─────────────────────────────────────────────────
  if (allDone) {
    return (
      <div style={{
        height: "100vh", display: "flex", flexDirection: "column",
        background: colors.bgDeep, fontFamily: fonts.sans,
      }}>
        {/* Progress bar — full */}
        <div style={{ height: 3, background: colors.accent, flexShrink: 0 }} />

        <div style={{
          flex: 1, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", gap: 24,
        }}>
          <div style={{
            width: 64, height: 64, borderRadius: "50%",
            background: `rgba(0, 232, 157, 0.12)`,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <CheckCircle size={32} color={colors.accent} />
          </div>
          <h1 style={{ ...typeScale.h1, color: colors.textPrimary, margin: 0, textAlign: "center" }}>
            All incidents reviewed!
          </h1>
          <p style={{ ...typeScale.body, color: colors.textSecondary, margin: 0, textAlign: "center" }}>
            {preferences.length} preference{preferences.length !== 1 ? "s" : ""} collected across {totalIncidents} incident{totalIncidents !== 1 ? "s" : ""}.
          </p>
          <button
            onClick={handleStartTraining}
            style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "14px 32px",
              borderRadius: radius.lg,
              background: `linear-gradient(135deg, ${colors.accent}, ${colors.accentBlue})`,
              border: "none",
              color: colors.bgDeep,
              fontFamily: fonts.sans,
              fontSize: 16, fontWeight: 700,
              cursor: "pointer",
              boxShadow: `0 0 30px rgba(0, 232, 157, 0.3)`,
              transition: "transform 0.15s, box-shadow 0.15s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = "scale(1.04)";
              e.currentTarget.style.boxShadow = "0 0 40px rgba(0, 232, 157, 0.45)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "scale(1)";
              e.currentTarget.style.boxShadow = "0 0 30px rgba(0, 232, 157, 0.3)";
            }}
          >
            Start Training
            <ArrowRight size={18} />
          </button>
        </div>
      </div>
    );
  }

  // ── Main compare view ──────────────────────────────────────────────
  return (
    <div style={{
      height: "100vh",
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
      background: colors.bgDeep,
      fontFamily: fonts.sans,
    }}>
      {/* Accent progress bar */}
      <div style={{ height: 3, background: colors.bgSurface, flexShrink: 0 }}>
        <div style={{
          height: "100%",
          width: `${progressPct}%`,
          background: `linear-gradient(90deg, ${colors.accent}, ${colors.accentBlue})`,
          transition: "width 0.4s ease",
          boxShadow: `0 0 8px ${colors.accentDim}`,
        }} />
      </div>

      {/* Top bar */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: `${spacing.sm}px ${spacing.lg}px`,
        flexShrink: 0,
        borderBottom: `1px solid ${colors.border}`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: spacing.md }}>
          <span style={{
            ...typeScale.caption,
            color: colors.accent,
            background: colors.accentGlow,
            padding: "3px 10px",
            borderRadius: radius.pill,
            border: `1px solid ${colors.borderAccent}`,
          }}>
            Reviewing incident {currentIdx + 1} of {totalIncidents}
          </span>
          {currentIncident && (
            <h1 style={{ ...typeScale.h2, color: colors.textPrimary, margin: 0 }}>
              {currentIncident.title}
            </h1>
          )}
        </div>
        <div style={{ display: "flex", gap: spacing.sm, alignItems: "center" }}>
          {/* Step dots */}
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            {incidents.map((_, i) => (
              <div key={i} style={{
                width: i === currentIdx ? 16 : 6,
                height: 6,
                borderRadius: radius.pill,
                background: i < currentIdx
                  ? colors.accent
                  : i === currentIdx
                  ? colors.accentBlue
                  : colors.bgOverlay,
                transition: "all 0.3s ease",
              }} />
            ))}
          </div>
          <button
            onClick={() => setIsPlaying((p) => !p)}
            style={headerBtnStyle}
          >
            {isPlaying ? <Pause size={13} /> : <Play size={13} />}
            <span style={{ fontSize: 11 }}>{isPlaying ? "Pause All" : "Play All"}</span>
          </button>
        </div>
      </div>

      {/* 2x2 grid */}
      <div style={{
        flex: 1,
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gridTemplateRows: "1fr 1fr",
        gap: spacing.sm,
        padding: spacing.sm,
        overflow: "hidden",
        minHeight: 0,
      }}>
        {OPTIONS.map((opt) => (
          <ComparisonTile
            key={opt.letter}
            option={opt}
            sceneData={variants[opt.variant]}
            scenarioId={scenarioId}
            playing={isPlaying}
            selected={selectedLetter === opt.letter}
          />
        ))}
      </div>

      {/* Bottom preference bar */}
      <div style={{
        flexShrink: 0,
        borderTop: `1px solid ${colors.border}`,
        background: colors.bgSurface,
        padding: `${spacing.md}px ${spacing.xl}px`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: spacing.md,
      }}>
        <span style={{
          ...typeScale.h3,
          color: colors.textPrimary,
          letterSpacing: "0.02em",
        }}>
          Which response was best?
        </span>

        <div style={{ display: "flex", gap: spacing.md }}>
          {OPTIONS.map((opt) => {
            const isSelected = selectedLetter === opt.letter;
            return (
              <button
                key={opt.letter}
                onClick={() => handleSelect(opt.letter)}
                disabled={!!selectedLetter}
                style={{
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
                  padding: "10px 24px",
                  borderRadius: radius.lg,
                  background: isSelected
                    ? `rgba(0, 232, 157, 0.2)`
                    : `${opt.color}10`,
                  border: isSelected
                    ? `2px solid ${colors.accent}`
                    : `1px solid ${opt.color}40`,
                  color: isSelected ? colors.accent : opt.color,
                  cursor: selectedLetter ? "default" : "pointer",
                  fontFamily: fonts.sans,
                  transition: "all 0.15s ease",
                  opacity: selectedLetter && !isSelected ? 0.35 : 1,
                  boxShadow: isSelected
                    ? `0 0 20px rgba(0, 232, 157, 0.35), inset 0 0 20px rgba(0, 232, 157, 0.08)`
                    : "none",
                  position: "relative",
                  overflow: "hidden",
                  minWidth: 100,
                }}
                onMouseEnter={(e) => {
                  if (!selectedLetter) {
                    e.currentTarget.style.background = `${opt.color}22`;
                    e.currentTarget.style.borderColor = `${opt.color}80`;
                    e.currentTarget.style.transform = "translateY(-2px)";
                    e.currentTarget.style.boxShadow = `0 4px 16px ${opt.color}25`;
                  }
                }}
                onMouseLeave={(e) => {
                  if (!selectedLetter) {
                    e.currentTarget.style.background = `${opt.color}10`;
                    e.currentTarget.style.borderColor = `${opt.color}40`;
                    e.currentTarget.style.transform = "translateY(0)";
                    e.currentTarget.style.boxShadow = "none";
                  }
                }}
              >
                {/* Selection flash overlay */}
                {isSelected && (
                  <div style={{
                    position: "absolute", inset: 0,
                    background: `radial-gradient(circle, rgba(0,232,157,0.25) 0%, transparent 70%)`,
                    animation: "cpflash 0.5s ease-out",
                    pointerEvents: "none",
                  }} />
                )}
                <span style={{ fontSize: 20, fontWeight: 800, lineHeight: 1 }}>
                  {isSelected ? <CheckCircle size={22} /> : opt.letter}
                </span>
                <span style={{
                  fontSize: 10, fontWeight: 500,
                  opacity: 0.8,
                  whiteSpace: "nowrap",
                }}>
                  {opt.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <style>{`
        @keyframes cpspin { to { transform: rotate(360deg); } }
        @keyframes cpflash {
          0%   { opacity: 1; transform: scale(0.8); }
          100% { opacity: 0; transform: scale(1.6); }
        }
      `}</style>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Comparison tile — independent playback
// ---------------------------------------------------------------------------

function ComparisonTile({
  option,
  sceneData,
  scenarioId,
  playing,
  selected,
}: {
  option: OptionDef;
  sceneData: SceneData;
  scenarioId: string;
  playing: boolean;
  selected: boolean;
}) {
  const metrics = VARIANT_METRICS[scenarioId as keyof typeof VARIANT_METRICS]?.[option.variant];
  const info = VARIANT_INFO[option.variant];
  const [displayTime, setDisplayTime] = useState("0.0");
  const frameRef = useRef(0);

  // Compute ego trajectory trail from scene data — shows how the ego moves
  const trail = useMemo<[number, number, number][]>(() => {
    const points: [number, number, number][] = [];
    const step = Math.max(1, Math.floor(sceneData.frames.length / 40)); // sample ~40 points
    for (let i = 0; i < sceneData.frames.length; i += step) {
      const f = sceneData.frames[i];
      points.push([f.egoPosition[0], f.egoPosition[1], f.egoPosition[2] + 0.5]);
    }
    return points;
  }, [sceneData]);

  // Stable mutable holder -- never changes reference, so Scene3D context won't re-render children
  const frameHolder = useMemo<FrameOverrideHolder>(
    () => ({ current: sceneData.frames[0] ?? null }),
    [],
  );

  // Reset frames when sceneData changes (new incident)
  useEffect(() => {
    frameRef.current = 0;
    frameHolder.current = sceneData.frames[0] ?? null;
    setDisplayTime("0.0");
  }, [sceneData, frameHolder]);

  // Playback via requestAnimationFrame
  useEffect(() => {
    if (!playing) return;
    let rafId: number;
    let lastAdvance = 0;
    let lastDisplayUpdate = 0;
    const frameInterval = 1000 / Math.max(1, sceneData.fps);

    const tick = (now: number) => {
      if (!lastAdvance) lastAdvance = now;
      if (!lastDisplayUpdate) lastDisplayUpdate = now;

      if (now - lastAdvance >= frameInterval) {
        frameRef.current = (frameRef.current + 1) % sceneData.totalFrames;
        frameHolder.current = sceneData.frames[frameRef.current] ?? null;
        lastAdvance = now;
      }

      if (now - lastDisplayUpdate >= 200) {
        setDisplayTime((frameRef.current / sceneData.fps).toFixed(1));
        lastDisplayUpdate = now;
      }

      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [playing, sceneData.fps, sceneData.totalFrames, sceneData.frames, frameHolder]);

  const statusColor = metrics?.status === "optimal"
    ? "#4ECDC4"
    : metrics?.status === "dangerous"
    ? "#FF6B6B"
    : "#FFD93D";

  return (
    <div style={{
      background: colors.bgCard,
      border: selected
        ? `2px solid ${colors.accent}`
        : `1px solid ${option.color}33`,
      borderRadius: radius.lg,
      overflow: "hidden",
      display: "flex",
      flexDirection: "column",
      position: "relative",
      transition: "border-color 0.2s, box-shadow 0.2s",
      boxShadow: selected
        ? `0 0 24px rgba(0, 232, 157, 0.3), inset 0 0 24px rgba(0, 232, 157, 0.05)`
        : "none",
    }}>
      {/* Tile header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: `4px ${spacing.md}px`,
        borderBottom: `1px solid ${colors.border}`,
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
          <div style={{
            width: 6, height: 6, borderRadius: "50%",
            background: option.color, flexShrink: 0,
          }} />
          <span style={{ ...typeScale.small, fontWeight: 600, color: colors.textPrimary }}>
            {info.label}
          </span>
          {info.description && (
            <span style={{ ...typeScale.caption, color: colors.textDim, fontSize: 9 }}>
              {info.description}
            </span>
          )}
          {metrics && (
            <span style={{
              fontSize: 9,
              fontFamily: fonts.mono,
              fontWeight: 600,
              padding: "1px 6px",
              borderRadius: 3,
              background: metrics.status === "optimal"
                ? "rgba(78,205,196,0.18)"
                : metrics.status === "dangerous"
                ? "rgba(255,107,107,0.18)"
                : "rgba(255,217,61,0.18)",
              color: statusColor,
            }}>
              R: {metrics.reward > 0 ? "+" : ""}{metrics.reward.toFixed(2)}
            </span>
          )}
        </div>
      </div>

      {/* 3D scene */}
      <div style={{ flex: 1, position: "relative", background: colors.bgDeep, minHeight: 0 }}>
        <Scene3D
          frameOverrideHolder={frameHolder}
          offset={VARIANT_OFFSETS[option.variant]}
          trail={trail}
          trailColor={option.color}
          lite
        />

        {/* Colored border highlight */}
        <div style={{
          position: "absolute", inset: 0,
          border: `2px solid ${option.color}30`,
          pointerEvents: "none",
        }} />

        {/* Large letter label */}
        <div style={{
          position: "absolute", top: 8, left: 10,
          width: 32, height: 32,
          borderRadius: radius.md,
          background: `${option.color}20`,
          border: `1px solid ${option.color}50`,
          display: "flex", alignItems: "center", justifyContent: "center",
          pointerEvents: "none",
        }}>
          <span style={{
            fontSize: 18, fontWeight: 800,
            color: option.color,
            lineHeight: 1,
          }}>
            {option.letter}
          </span>
        </div>

        {/* Time overlay */}
        <div style={{
          position: "absolute", bottom: 6, left: 6,
          ...typeScale.mono, fontSize: 10,
          color: option.color,
          background: "rgba(10,13,22,0.88)",
          padding: "2px 8px", borderRadius: 4,
          pointerEvents: "none",
        }}>
          {displayTime}s / {sceneData.totalSeconds.toFixed(1)}s
        </div>

        {/* Metrics overlay */}
        {metrics && (
          <div style={{
            position: "absolute", bottom: 6, right: 6,
            ...typeScale.mono, fontSize: 9,
            color: colors.textDim,
            background: "rgba(10,13,22,0.88)",
            padding: "3px 8px", borderRadius: 4,
            pointerEvents: "none",
            display: "flex", gap: 8,
          }}>
            <span>
              Safety:{" "}
              <span style={{
                color: metrics.safety > 0.7 ? "#4ECDC4" : metrics.safety > 0.3 ? "#FFD93D" : "#FF6B6B",
              }}>
                {(metrics.safety * 100).toFixed(0)}%
              </span>
            </span>
            <span>
              TTC:{" "}
              <span style={{
                color: metrics.ttc > 3 ? "#4ECDC4" : metrics.ttc > 1.5 ? "#FFD93D" : "#FF6B6B",
              }}>
                {metrics.ttc === Infinity ? "\u221E" : metrics.ttc.toFixed(1) + "s"}
              </span>
            </span>
          </div>
        )}

        {/* Selection glow overlay */}
        {selected && (
          <div style={{
            position: "absolute", inset: 0,
            background: `radial-gradient(ellipse at center, rgba(0,232,157,0.15) 0%, transparent 60%)`,
            pointerEvents: "none",
            animation: "cpflash 0.6s ease-out",
          }} />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const headerBtnStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 5,
  padding: "4px 12px",
  borderRadius: 6,
  background: "rgba(255,255,255,0.04)",
  border: `1px solid ${colors.border}`,
  color: colors.textSecondary,
  cursor: "pointer",
  fontFamily: fonts.sans,
  fontSize: 11,
};
