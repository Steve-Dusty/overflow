/**
 * TrainPage — GRPO training dashboard.
 * Shows real-time training metrics, an SVG reward/loss chart,
 * a terminal-style log console, and a 3-phase progress indicator.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useStore } from "../store";
import { runMockTraining } from "../lib/mockTraining";
import { colors, fonts, typeScale, spacing, glass, radius } from "../theme";
import { Brain, Zap, ArrowRight, Activity, CheckCircle } from "lucide-react";
import type { TrainingMetric } from "../lib/types";

// ─── Phase mapping ──────────────────────────────────────────────────────────
const PHASE_LABELS: Record<string, string> = {
  reward_model: "Phase 1: Reward Model Training",
  grpo: "Phase 2: GRPO Policy Optimization",
  eval: "Phase 3: Evaluation",
  complete: "Training Complete",
};

const PHASE_SHORT: Record<string, string> = {
  reward_model: "Reward Model",
  grpo: "GRPO",
  eval: "Evaluation",
};

const PHASE_ORDER = ["reward_model", "grpo", "eval"] as const;

// ─── Inline SVG chart ───────────────────────────────────────────────────────
function MetricChart({
  metrics,
  width,
  height,
}: {
  metrics: TrainingMetric[];
  width: number;
  height: number;
}) {
  if (metrics.length === 0) {
    return (
      <div
        style={{
          width,
          height,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: colors.textDim,
          fontFamily: fonts.mono,
          fontSize: 12,
        }}
      >
        Waiting for metrics...
      </div>
    );
  }

  const pad = { top: 20, right: 16, bottom: 28, left: 48 };
  const cw = width - pad.left - pad.right;
  const ch = height - pad.top - pad.bottom;

  // Reward line (green)
  const rewards = metrics.map((m) => m.avgReward);
  const rMin = Math.min(...rewards) - 0.05;
  const rMax = Math.max(...rewards) + 0.05;

  // Loss line (red)
  const losses = metrics.map((m) => m.loss);
  const lMin = Math.min(...losses) - 0.02;
  const lMax = Math.max(...losses) + 0.02;

  const steps = metrics.map((m) => m.step);
  const sMin = steps[0];
  const sMax = steps[steps.length - 1] || 1;

  const toX = (step: number) =>
    pad.left + ((step - sMin) / Math.max(sMax - sMin, 1)) * cw;
  const toYReward = (v: number) =>
    pad.top + (1 - (v - rMin) / Math.max(rMax - rMin, 0.01)) * ch;
  const toYLoss = (v: number) =>
    pad.top + (1 - (v - lMin) / Math.max(lMax - lMin, 0.01)) * ch;

  const rewardPoints = metrics
    .map((m) => `${toX(m.step).toFixed(1)},${toYReward(m.avgReward).toFixed(1)}`)
    .join(" ");
  const lossPoints = metrics
    .map((m) => `${toX(m.step).toFixed(1)},${toYLoss(m.loss).toFixed(1)}`)
    .join(" ");

  // Grid lines (5 horizontal)
  const gridLines = Array.from({ length: 5 }, (_, i) => {
    const y = pad.top + (ch / 4) * i;
    return y;
  });

  // Vertical grid (every 20 steps)
  const vLines: number[] = [];
  for (let s = Math.ceil(sMin / 20) * 20; s <= sMax; s += 20) {
    vLines.push(toX(s));
  }

  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      {/* Background */}
      <rect width={width} height={height} rx={8} fill={colors.bgDeep} />

      {/* Grid */}
      {gridLines.map((y, i) => (
        <line
          key={`h-${i}`}
          x1={pad.left}
          y1={y}
          x2={width - pad.right}
          y2={y}
          stroke={colors.border}
          strokeWidth={0.5}
          strokeDasharray="4 4"
        />
      ))}
      {vLines.map((x, i) => (
        <line
          key={`v-${i}`}
          x1={x}
          y1={pad.top}
          x2={x}
          y2={height - pad.bottom}
          stroke={colors.border}
          strokeWidth={0.5}
          strokeDasharray="4 4"
        />
      ))}

      {/* Axis labels */}
      <text
        x={pad.left - 6}
        y={pad.top + 4}
        fill={colors.textDim}
        fontSize={9}
        fontFamily={fonts.mono}
        textAnchor="end"
      >
        {rMax.toFixed(2)}
      </text>
      <text
        x={pad.left - 6}
        y={height - pad.bottom + 4}
        fill={colors.textDim}
        fontSize={9}
        fontFamily={fonts.mono}
        textAnchor="end"
      >
        {rMin.toFixed(2)}
      </text>
      <text
        x={pad.left}
        y={height - pad.bottom + 16}
        fill={colors.textDim}
        fontSize={9}
        fontFamily={fonts.mono}
        textAnchor="start"
      >
        Step {sMin}
      </text>
      <text
        x={width - pad.right}
        y={height - pad.bottom + 16}
        fill={colors.textDim}
        fontSize={9}
        fontFamily={fonts.mono}
        textAnchor="end"
      >
        Step {sMax}
      </text>

      {/* Glow filters */}
      <defs>
        <filter id="glow-green" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="glow-red" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="2.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Loss polyline (red) */}
      <polyline
        points={lossPoints}
        fill="none"
        stroke={colors.error}
        strokeWidth={1.8}
        strokeLinejoin="round"
        strokeLinecap="round"
        filter="url(#glow-red)"
        opacity={0.7}
      />

      {/* Reward polyline (green) */}
      <polyline
        points={rewardPoints}
        fill="none"
        stroke={colors.accent}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        filter="url(#glow-green)"
      />

      {/* Latest point dot — reward */}
      {metrics.length > 0 && (
        <circle
          cx={toX(metrics[metrics.length - 1].step)}
          cy={toYReward(metrics[metrics.length - 1].avgReward)}
          r={4}
          fill={colors.accent}
          stroke={colors.bgDeep}
          strokeWidth={2}
        >
          <animate attributeName="r" values="4;6;4" dur="1.5s" repeatCount="indefinite" />
        </circle>
      )}

      {/* Legend */}
      <circle cx={pad.left + 8} cy={pad.top - 8} r={3} fill={colors.accent} />
      <text
        x={pad.left + 16}
        y={pad.top - 5}
        fill={colors.textSecondary}
        fontSize={9}
        fontFamily={fonts.mono}
      >
        Avg Reward
      </text>
      <circle cx={pad.left + 100} cy={pad.top - 8} r={3} fill={colors.error} />
      <text
        x={pad.left + 108}
        y={pad.top - 5}
        fill={colors.textSecondary}
        fontSize={9}
        fontFamily={fonts.mono}
      >
        Loss
      </text>
    </svg>
  );
}

// ─── Confetti particle effect ───────────────────────────────────────────────
function Confetti() {
  const particles = useRef(
    Array.from({ length: 40 }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      delay: Math.random() * 2,
      duration: 2 + Math.random() * 3,
      size: 3 + Math.random() * 5,
      opacity: 0.4 + Math.random() * 0.6,
    })),
  ).current;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        pointerEvents: "none",
        zIndex: 10,
      }}
    >
      <style>{`
        @keyframes confetti-fall {
          0%   { transform: translateY(-20px) rotate(0deg); opacity: 1; }
          100% { transform: translateY(120vh) rotate(720deg); opacity: 0; }
        }
      `}</style>
      {particles.map((p) => (
        <div
          key={p.id}
          style={{
            position: "absolute",
            left: `${p.x}%`,
            top: -20,
            width: p.size,
            height: p.size,
            borderRadius: p.id % 3 === 0 ? "50%" : 2,
            background:
              p.id % 4 === 0
                ? colors.accent
                : p.id % 4 === 1
                  ? colors.accentBlue
                  : p.id % 4 === 2
                    ? colors.accentDim
                    : colors.success,
            opacity: p.opacity,
            animation: `confetti-fall ${p.duration}s ease-in ${p.delay}s forwards`,
          }}
        />
      ))}
    </div>
  );
}

// ─── Phase Indicator ────────────────────────────────────────────────────────
function PhaseIndicator({ current }: { current: string }) {
  const idx = PHASE_ORDER.indexOf(current as any);
  const isComplete = current === "complete";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 0,
        padding: `${spacing.lg}px 0`,
      }}
    >
      <style>{`
        @keyframes phase-pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(0,232,157,0.4); }
          50%       { box-shadow: 0 0 0 8px rgba(0,232,157,0); }
        }
      `}</style>
      {PHASE_ORDER.map((phase, i) => {
        const active = isComplete || i < idx || phase === current;
        const isCurrent = phase === current;

        return (
          <div
            key={phase}
            style={{ display: "flex", alignItems: "center" }}
          >
            {/* Connector line (before all except first) */}
            {i > 0 && (
              <div
                style={{
                  width: 60,
                  height: 2,
                  background: active
                    ? colors.accent
                    : colors.border,
                  transition: "background 0.5s ease",
                }}
              />
            )}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: spacing.xs,
              }}
            >
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: active
                    ? `linear-gradient(135deg, ${colors.accent}, ${colors.accentBlue})`
                    : colors.bgCard,
                  border: `2px solid ${active ? colors.accent : colors.border}`,
                  color: active ? colors.bgDeep : colors.textDim,
                  fontSize: 14,
                  fontWeight: 700,
                  fontFamily: fonts.mono,
                  animation: isCurrent ? "phase-pulse 2s ease infinite" : "none",
                  transition: "all 0.5s ease",
                }}
              >
                {isComplete || i < idx ? (
                  <CheckCircle size={16} />
                ) : (
                  i + 1
                )}
              </div>
              <span
                style={{
                  ...typeScale.caption,
                  color: isCurrent ? colors.accent : active ? colors.textSecondary : colors.textDim,
                  whiteSpace: "nowrap",
                  transition: "color 0.5s ease",
                }}
              >
                {PHASE_SHORT[phase]}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Metric Card ────────────────────────────────────────────────────────────
function MetricCard({
  label,
  value,
  unit,
  icon,
  color,
  changed,
}: {
  label: string;
  value: string;
  unit: string;
  icon: React.ReactNode;
  color: string;
  changed: boolean;
}) {
  return (
    <div
      style={{
        ...glass,
        padding: spacing.lg,
        display: "flex",
        flexDirection: "column",
        gap: spacing.sm,
        borderColor: changed ? color : colors.border,
        boxShadow: changed
          ? `0 0 20px ${color}22, inset 0 0 20px ${color}08`
          : "none",
        transition: "border-color 0.4s ease, box-shadow 0.4s ease",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span
          style={{
            ...typeScale.caption,
            color: colors.textSecondary,
          }}
        >
          {label}
        </span>
        <div style={{ color: colors.textDim }}>{icon}</div>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
        <span
          style={{
            fontSize: 28,
            fontWeight: 700,
            fontFamily: fonts.mono,
            color,
            letterSpacing: "-0.03em",
            lineHeight: 1,
          }}
        >
          {value}
        </span>
        <span
          style={{
            ...typeScale.small,
            color: colors.textDim,
          }}
        >
          {unit}
        </span>
      </div>
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────
export default function TrainPage() {
  const navigate = useNavigate();

  const trainingStatus = useStore((s) => s.trainingStatus);
  const trainingMetrics = useStore((s) => s.trainingMetrics);
  const trainingLogs = useStore((s) => s.trainingLogs);
  const preferences = useStore((s) => s.preferences);
  const trainedModel = useStore((s) => s.trainedModel);
  const actions = useStore((s) => s.actions);

  const logRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);
  const [changedCards, setChangedCards] = useState<Set<string>>(new Set());
  const [showComplete, setShowComplete] = useState(false);

  // Determine current phase from latest metric
  const currentPhase =
    trainingStatus === "complete"
      ? "complete"
      : trainingMetrics.length > 0
        ? trainingMetrics[trainingMetrics.length - 1].phase
        : "reward_model";

  // Latest metric values
  const latest = trainingMetrics.length > 0 ? trainingMetrics[trainingMetrics.length - 1] : null;
  const prevMetric =
    trainingMetrics.length > 1 ? trainingMetrics[trainingMetrics.length - 2] : null;

  // Flash metric cards on change
  useEffect(() => {
    if (!latest) return;
    const changed = new Set<string>();
    if (prevMetric) {
      if (latest.avgReward !== prevMetric.avgReward) changed.add("reward");
      if (latest.collisionRate !== prevMetric.collisionRate) changed.add("collision");
      if (latest.avgTTC !== prevMetric.avgTTC) changed.add("ttc");
      if (latest.kl !== prevMetric.kl) changed.add("kl");
    }
    setChangedCards(changed);
    const t = setTimeout(() => setChangedCards(new Set()), 500);
    return () => clearTimeout(t);
  }, [latest?.step]);

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [trainingLogs.length]);

  // Start training on mount if idle
  useEffect(() => {
    if (trainingStatus !== "idle" || startedRef.current) return;
    startedRef.current = true;

    const prefs = preferences.length > 0 ? preferences : [
      // Provide a default if none exist
      {
        id: "demo-1",
        incidentId: "demo",
        scenarioId: "hard_braking" as any,
        options: [],
        selectedOptionId: 0,
        timestamp: Date.now(),
      },
    ];

    actions.addTrainingLog("[SYSTEM] Initializing GRPO training pipeline...");
    actions.addTrainingLog(`[SYSTEM] ${prefs.length} preference pair(s) loaded`);

    runMockTraining(prefs, {
      onMetric: (metric) => {
        actions.addTrainingMetric(metric);
        // Update progress
        const totalSteps = 130; // 40 RM + 80 GRPO + 10 eval
        actions.setTrainingProgress(Math.min(1, metric.step / totalSteps));
      },
      onPhaseChange: (phase) => {
        actions.setTrainingStatus(phase as any);
        actions.addTrainingLog(
          `[PHASE] >>> ${PHASE_LABELS[phase] ?? phase} <<<`,
        );
      },
      onComplete: (model) => {
        actions.setTrainedModel(model);
        actions.setTrainingStatus("complete");
        actions.setTrainingProgress(1);
        actions.addTrainingLog("[COMPLETE] Training finished successfully.");
        setShowComplete(true);
      },
      onLog: (msg) => {
        actions.addTrainingLog(`[TRAIN] ${msg}`);
      },
    });
  }, [trainingStatus]);

  // Collision rate color
  const collisionColor =
    latest && latest.collisionRate > 0.08
      ? colors.error
      : latest && latest.collisionRate > 0.03
        ? colors.warning
        : colors.success;

  const rewardColor =
    prevMetric && latest && latest.avgReward > prevMetric.avgReward
      ? colors.success
      : colors.textPrimary;

  // Overall progress percentage
  const progressPct = useStore((s) => s.trainingProgress);

  const handleExport = useCallback(() => {
    actions.setPipelineStage("export");
    navigate("/export");
  }, [actions, navigate]);

  // Compute summary text for completion
  const summaryText = trainedModel
    ? `Policy improved: reward +${(trainedModel.evalMetrics.avgReward - 0.34).toFixed(2)}, collision rate ${((trainedModel.evalMetrics.collisionRate - 0.12) * 100).toFixed(1)}%`
    : "";

  return (
    <div
      style={{
        width: "100%",
        height: "100vh",
        background: colors.bgDeep,
        fontFamily: fonts.sans,
        color: colors.textPrimary,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        position: "relative",
      }}
    >
      {/* Confetti on complete */}
      {showComplete && <Confetti />}

      {/* ── Header ─────────────────────────────────────────────────── */}
      <div
        style={{
          padding: `${spacing.lg}px ${spacing.xl}px ${spacing.sm}px`,
          borderBottom: `1px solid ${colors.border}`,
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: spacing.md }}>
            <Brain size={22} color={colors.accent} />
            <span style={{ ...typeScale.h2, color: colors.textPrimary }}>
              GRPO Training Monitor
            </span>
            <span
              style={{
                ...typeScale.caption,
                color: colors.accent,
                background: colors.accentGlow,
                padding: "2px 8px",
                borderRadius: radius.pill,
              }}
            >
              {trainingStatus === "complete" ? "DONE" : "LIVE"}
            </span>
          </div>
          <div
            style={{
              ...typeScale.small,
              color: colors.textDim,
              fontFamily: fonts.mono,
            }}
          >
            {PHASE_LABELS[currentPhase] ?? "Initializing..."}
          </div>
        </div>

        {/* Phase indicator */}
        <PhaseIndicator current={currentPhase} />

        {/* Overall progress bar */}
        <div
          style={{
            width: "100%",
            height: 4,
            background: colors.bgCard,
            borderRadius: radius.pill,
            overflow: "hidden",
            marginBottom: spacing.sm,
          }}
        >
          <div
            style={{
              width: `${(progressPct * 100).toFixed(1)}%`,
              height: "100%",
              background: `linear-gradient(90deg, ${colors.accent}, ${colors.accentBlue})`,
              borderRadius: radius.pill,
              transition: "width 0.3s ease",
              boxShadow: `0 0 12px ${colors.accentDim}`,
            }}
          />
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            ...typeScale.caption,
            color: colors.textDim,
            marginBottom: spacing.xs,
          }}
        >
          <span>Step {latest?.step ?? 0} / 130</span>
          <span>{(progressPct * 100).toFixed(0)}%</span>
        </div>
      </div>

      {/* ── Main content ───────────────────────────────────────────── */}
      <div
        style={{
          flex: 1,
          display: "flex",
          overflow: "hidden",
          minHeight: 0,
        }}
      >
        {/* ── LEFT: Metrics ──────────────────────────────────────── */}
        <div
          style={{
            flex: "0 0 60%",
            padding: spacing.xl,
            display: "flex",
            flexDirection: "column",
            gap: spacing.lg,
            overflow: "auto",
          }}
        >
          {/* Current phase label */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: spacing.sm,
            }}
          >
            <style>{`
              @keyframes pulse-dot {
                0%, 100% { opacity: 1; }
                50%       { opacity: 0.3; }
              }
            `}</style>
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: trainingStatus === "complete" ? colors.success : colors.accent,
                animation:
                  trainingStatus === "complete" ? "none" : "pulse-dot 1.2s ease infinite",
              }}
            />
            <span style={{ ...typeScale.h3, color: colors.textSecondary }}>
              {trainingStatus === "complete"
                ? "All Phases Complete"
                : PHASE_LABELS[currentPhase] ?? "Starting..."}
            </span>
          </div>

          {/* Metric cards 2x2 */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: spacing.lg,
            }}
          >
            <MetricCard
              label="Avg Reward"
              value={latest ? latest.avgReward.toFixed(3) : "---"}
              unit=""
              icon={<Zap size={16} />}
              color={rewardColor}
              changed={changedCards.has("reward")}
            />
            <MetricCard
              label="Collision Rate"
              value={
                latest
                  ? latest.collisionRate > 0
                    ? (latest.collisionRate * 100).toFixed(1)
                    : "0.0"
                  : "---"
              }
              unit="%"
              icon={<Activity size={16} />}
              color={collisionColor}
              changed={changedCards.has("collision")}
            />
            <MetricCard
              label="Avg TTC"
              value={latest ? latest.avgTTC.toFixed(1) : "---"}
              unit="s"
              icon={<Activity size={16} />}
              color={colors.accentBlue}
              changed={changedCards.has("ttc")}
            />
            <MetricCard
              label="KL Divergence"
              value={latest ? latest.kl.toFixed(4) : "---"}
              unit=""
              icon={<Brain size={16} />}
              color={
                latest && latest.kl > 0.045
                  ? colors.warning
                  : colors.textPrimary
              }
              changed={changedCards.has("kl")}
            />
          </div>

          {/* SVG chart */}
          <div
            style={{
              flex: 1,
              minHeight: 200,
              borderRadius: radius.lg,
              overflow: "hidden",
            }}
          >
            <MetricChart
              metrics={trainingMetrics}
              width={600}
              height={260}
            />
          </div>

          {/* Completion banner */}
          {showComplete && trainedModel && (
            <div
              style={{
                ...glass,
                padding: spacing.xl,
                textAlign: "center",
                borderColor: colors.accent,
                boxShadow: `0 0 40px ${colors.accentDim}`,
                position: "relative",
                overflow: "hidden",
              }}
            >
              {/* Glow sweep */}
              <style>{`
                @keyframes sweep {
                  0%   { transform: translateX(-100%); }
                  100% { transform: translateX(200%); }
                }
              `}</style>
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background: `linear-gradient(90deg, transparent, ${colors.accentGlow}, transparent)`,
                  animation: "sweep 3s ease-in-out infinite",
                  pointerEvents: "none",
                }}
              />

              <CheckCircle
                size={40}
                color={colors.accent}
                style={{ margin: "0 auto 12px" }}
              />
              <div
                style={{
                  ...typeScale.h1,
                  color: colors.accent,
                  marginBottom: spacing.sm,
                }}
              >
                Training Complete
              </div>
              <div
                style={{
                  ...typeScale.body,
                  color: colors.textSecondary,
                  marginBottom: spacing.lg,
                  fontFamily: fonts.mono,
                }}
              >
                {summaryText}
              </div>
              <button
                onClick={handleExport}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: spacing.sm,
                  padding: `${spacing.md}px ${spacing.xl}px`,
                  background: `linear-gradient(135deg, ${colors.accent}, ${colors.accentBlue})`,
                  color: colors.bgDeep,
                  border: "none",
                  borderRadius: radius.md,
                  fontFamily: fonts.sans,
                  fontWeight: 600,
                  fontSize: 14,
                  cursor: "pointer",
                  transition: "transform 0.2s ease, box-shadow 0.2s ease",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.transform = "translateY(-1px)";
                  (e.currentTarget as HTMLButtonElement).style.boxShadow = `0 4px 20px ${colors.accentDim}`;
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.transform = "none";
                  (e.currentTarget as HTMLButtonElement).style.boxShadow = "none";
                }}
              >
                Export Model
                <ArrowRight size={16} />
              </button>
            </div>
          )}
        </div>

        {/* ── RIGHT: Training Log ────────────────────────────────── */}
        <div
          style={{
            flex: "0 0 40%",
            borderLeft: `1px solid ${colors.border}`,
            display: "flex",
            flexDirection: "column",
            background: colors.bgBase,
          }}
        >
          {/* Log header */}
          <div
            style={{
              padding: `${spacing.md}px ${spacing.lg}px`,
              borderBottom: `1px solid ${colors.border}`,
              display: "flex",
              alignItems: "center",
              gap: spacing.sm,
              flexShrink: 0,
            }}
          >
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background:
                  trainingStatus === "complete" ? colors.success : colors.accent,
                animation:
                  trainingStatus === "complete"
                    ? "none"
                    : "pulse-dot 1.2s ease infinite",
              }}
            />
            <span style={{ ...typeScale.caption, color: colors.textSecondary }}>
              Training Log
            </span>
            <span
              style={{
                ...typeScale.caption,
                color: colors.textDim,
                marginLeft: "auto",
              }}
            >
              {trainingLogs.length} entries
            </span>
          </div>

          {/* Log body */}
          <div
            ref={logRef}
            style={{
              flex: 1,
              overflowY: "auto",
              padding: spacing.md,
              fontFamily: fonts.mono,
              fontSize: 11,
              lineHeight: 1.6,
              scrollbarWidth: "thin",
              scrollbarColor: `${colors.border} transparent`,
            }}
          >
            {trainingLogs.map((msg, i) => {
              let logColor: string = colors.textSecondary;
              if (msg.includes("[COMPLETE]") || msg.includes("converged") || msg.includes("complete") || msg.includes("improved")) {
                logColor = colors.success;
              } else if (msg.includes("[PHASE]")) {
                logColor = colors.accent;
              } else if (msg.includes("KL approaching") || msg.includes("slowing")) {
                logColor = colors.warning;
              } else if (msg.includes("[SYSTEM]")) {
                logColor = colors.accentBlue;
              } else if (msg.includes("dropped below") || msg.includes("emerging") || msg.includes("learning")) {
                logColor = colors.success;
              }

              return (
                <div
                  key={i}
                  style={{
                    color: logColor,
                    padding: `2px 0`,
                    borderBottom: `1px solid ${colors.borderSubtle}`,
                    wordBreak: "break-word",
                  }}
                >
                  <span style={{ color: colors.textDim, marginRight: 8 }}>
                    {String(i).padStart(3, "0")}
                  </span>
                  {msg}
                </div>
              );
            })}

            {/* Blinking cursor at bottom when training */}
            {trainingStatus !== "complete" && (
              <div style={{ color: colors.accent, marginTop: 4 }}>
                <style>{`
                  @keyframes blink-cursor {
                    0%, 50% { opacity: 1; }
                    51%, 100% { opacity: 0; }
                  }
                `}</style>
                <span
                  style={{
                    animation: "blink-cursor 1s step-end infinite",
                  }}
                >
                  _
                </span>
              </div>
            )}
          </div>

          {/* Log footer with latest metric summary */}
          {latest && (
            <div
              style={{
                padding: `${spacing.sm}px ${spacing.lg}px`,
                borderTop: `1px solid ${colors.border}`,
                display: "flex",
                gap: spacing.lg,
                flexShrink: 0,
                ...typeScale.caption,
                color: colors.textDim,
                fontFamily: fonts.mono,
              }}
            >
              <span>
                LR: {latest.lr.toExponential(1)}
              </span>
              <span>
                GRAD: {latest.gradNorm.toFixed(2)}
              </span>
              <span>
                LOSS: {latest.loss.toFixed(4)}
              </span>
              <span>
                EPOCH: {latest.epoch}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
