/**
 * RankPage — Preference ranking for counterfactual variants.
 * Users drag-to-reorder the 4 variants; the resulting pairwise
 * comparisons feed GRPO training (visualized on the knowledge graph page).
 */

import { useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { VARIANT_INFO, VARIANT_METRICS } from "../mockData";
import type { SceneVariant, ScenarioId } from "../mockData";
import { useStore } from "../store";
import { colors, fonts, typeScale, spacing, glass, radius } from "../theme";
import { GripVertical, ArrowRight, CheckCircle, Trophy } from "lucide-react";

// ── Local types ────────────────────────────────────────────────────

interface RankCard {
  variant: SceneVariant;
  label: string;
  description: string;
  color: string;
}

// ── Constants ──────────────────────────────────────────────────────

const VARIANT_COLORS: Record<SceneVariant, string> = {
  ground_truth: "#4ECDC4",
  avoid_left: "#FFD93D",
  avoid_right: "#FF6B6B",
  emergency_brake: "#7B68EE",
};

const INITIAL_ORDER: RankCard[] = [
  {
    variant: "ground_truth",
    label: "Continue Path",
    description: VARIANT_INFO.ground_truth.description || "Maintain current trajectory — no evasive action",
    color: VARIANT_COLORS.ground_truth,
  },
  {
    variant: "avoid_left",
    label: "Swerve Left",
    description: VARIANT_INFO.avoid_left.description,
    color: VARIANT_COLORS.avoid_left,
  },
  {
    variant: "avoid_right",
    label: "Swerve Right",
    description: VARIANT_INFO.avoid_right.description,
    color: VARIANT_COLORS.avoid_right,
  },
  {
    variant: "emergency_brake",
    label: "Emergency Brake",
    description: VARIANT_INFO.emergency_brake.description,
    color: VARIANT_COLORS.emergency_brake,
  },
];

const RANK_LABELS = ["1st", "2nd", "3rd", "4th"] as const;

const PAIR_COUNT = 6; // C(4,2) = 6 pairwise comparisons

// ── Component ──────────────────────────────────────────────────────

export default function RankPage() {
  const navigate = useNavigate();
  const scenarioId = useStore((s) => s.scenarioId) as ScenarioId;
  const metrics = VARIANT_METRICS[scenarioId] ?? VARIANT_METRICS.near_miss;

  const [cards, setCards] = useState<RankCard[]>(INITIAL_ORDER);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const dragNode = useRef<HTMLDivElement | null>(null);

  // ── Drag handlers ────────────────────────────────────────────────

  const handleDragStart = useCallback(
    (e: React.DragEvent<HTMLDivElement>, idx: number) => {
      setDragIndex(idx);
      dragNode.current = e.currentTarget as HTMLDivElement;
      // Needed for Firefox
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(idx));
      // Slight delay so the browser captures the element before we style it
      requestAnimationFrame(() => {
        if (dragNode.current) {
          dragNode.current.style.opacity = "0.45";
        }
      });
    },
    [],
  );

  const handleDragEnd = useCallback(() => {
    if (dragNode.current) {
      dragNode.current.style.opacity = "1";
    }
    setDragIndex(null);
    setOverIndex(null);
    dragNode.current = null;
  }, []);

  const handleDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>, idx: number) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (dragIndex !== null && idx !== dragIndex) {
        setOverIndex(idx);
      }
    },
    [dragIndex],
  );

  const handleDragLeave = useCallback(() => {
    setOverIndex(null);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>, dropIdx: number) => {
      e.preventDefault();
      if (dragIndex === null || dragIndex === dropIdx) return;

      setCards((prev) => {
        const next = [...prev];
        const [moved] = next.splice(dragIndex, 1);
        next.splice(dropIdx, 0, moved);
        return next;
      });

      setDragIndex(null);
      setOverIndex(null);
    },
    [dragIndex],
  );

  // ── Submit ───────────────────────────────────────────────────────

  const handleSubmit = useCallback(() => {
    setSubmitted(true);
    toast.success(
      `Ranking submitted \u2014 ${PAIR_COUNT} preference pairs added to training data`,
    );
    setTimeout(() => navigate("/graph"), 600);
  }, [navigate]);

  // ── Helpers ──────────────────────────────────────────────────────

  const fmtReward = (r: number) => (r >= 0 ? `+${r.toFixed(2)}` : r.toFixed(2));
  const fmtSafety = (s: number) => `${Math.round(s * 100)}%`;
  const fmtTTC = (t: number) => (t === Infinity ? "\u221E" : `${t.toFixed(1)}s`);

  // ── Render ───────────────────────────────────────────────────────

  return (
    <div
      style={{
        minHeight: "100vh",
        background: colors.bgDeep,
        fontFamily: fonts.sans,
        color: colors.textPrimary,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: `${spacing.xxl + 16}px ${spacing.xl}px ${spacing.xxl}px`,
      }}
    >
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div style={{ textAlign: "center", marginBottom: spacing.xxl }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: spacing.sm,
            marginBottom: spacing.sm,
          }}
        >
          <Trophy size={28} color={colors.accent} />
          <h1
            style={{
              ...typeScale.h1,
              fontSize: 28,
              margin: 0,
              background: "linear-gradient(135deg, #00E89D, #00C9DB)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            Rank Counterfactual Responses
          </h1>
        </div>
        <p
          style={{
            ...typeScale.body,
            color: colors.textSecondary,
            margin: 0,
          }}
        >
          Drag to reorder &mdash; best response first
        </p>
      </div>

      {/* ── Card list ──────────────────────────────────────────────── */}
      <div
        style={{
          width: "100%",
          maxWidth: 680,
          display: "flex",
          flexDirection: "column",
          gap: spacing.md,
        }}
      >
        {cards.map((card, idx) => {
          const m = metrics[card.variant];
          const isDragging = dragIndex === idx;
          const isOver = overIndex === idx;
          const isFirst = idx === 0;

          return (
            <div
              key={card.variant}
              draggable
              onDragStart={(e) => handleDragStart(e, idx)}
              onDragEnd={handleDragEnd}
              onDragOver={(e) => handleDragOver(e, idx)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, idx)}
              style={{
                ...glass,
                display: "flex",
                alignItems: "center",
                gap: spacing.lg,
                padding: `${spacing.lg}px ${spacing.xl}px`,
                borderLeft: `4px solid ${card.color}`,
                borderTop: isOver && dragIndex !== null && dragIndex > idx
                  ? `2px solid ${colors.accent}`
                  : undefined,
                borderBottom: isOver && dragIndex !== null && dragIndex < idx
                  ? `2px solid ${colors.accent}`
                  : undefined,
                cursor: "grab",
                transition: "transform 0.2s ease, box-shadow 0.2s ease, opacity 0.2s ease",
                transform: isDragging
                  ? "scale(1.03)"
                  : isOver
                    ? "translateY(0)"
                    : "none",
                boxShadow: isDragging
                  ? `0 8px 32px rgba(0,232,157,0.18), 0 0 0 1px ${colors.accent}`
                  : isFirst
                    ? `0 0 20px ${card.color}22, inset 0 0 40px ${card.color}08`
                    : "none",
                position: "relative",
                userSelect: "none",
              }}
            >
              {/* Rank number */}
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: radius.md,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  background: isFirst
                    ? "linear-gradient(135deg, #FFD93D, #F5A623)"
                    : colors.bgSurface,
                  border: isFirst
                    ? "none"
                    : `1px solid ${colors.border}`,
                  fontFamily: fonts.mono,
                  fontSize: 20,
                  fontWeight: 700,
                  color: isFirst ? colors.bgDeep : colors.textSecondary,
                }}
              >
                {idx + 1}
              </div>

              {/* Color dot + text */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: spacing.sm,
                    marginBottom: 4,
                  }}
                >
                  <div
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      background: card.color,
                      boxShadow: `0 0 8px ${card.color}88`,
                      flexShrink: 0,
                    }}
                  />
                  <span
                    style={{
                      ...typeScale.h3,
                      color: isFirst ? card.color : colors.textPrimary,
                    }}
                  >
                    {card.label}
                  </span>
                  {isFirst && (
                    <span
                      style={{
                        ...typeScale.caption,
                        color: "#FFD93D",
                        background: "rgba(255,217,61,0.12)",
                        padding: "2px 8px",
                        borderRadius: radius.pill,
                        marginLeft: 4,
                      }}
                    >
                      BEST
                    </span>
                  )}
                </div>

                <p
                  style={{
                    ...typeScale.small,
                    color: colors.textSecondary,
                    margin: `0 0 ${spacing.sm}px`,
                  }}
                >
                  {card.description}
                </p>

                {/* Metrics row */}
                <div
                  style={{
                    display: "flex",
                    gap: spacing.lg,
                    flexWrap: "wrap",
                  }}
                >
                  <MetricChip
                    label="Reward"
                    value={fmtReward(m.reward)}
                    accent={m.reward >= 0.5 ? colors.success : m.reward >= 0 ? colors.warning : colors.error}
                  />
                  <MetricChip
                    label="Safety"
                    value={fmtSafety(m.safety)}
                    accent={m.safety >= 0.8 ? colors.success : m.safety >= 0.5 ? colors.warning : colors.error}
                  />
                  <MetricChip
                    label="TTC"
                    value={fmtTTC(m.ttc)}
                    accent={m.ttc >= 3 ? colors.success : m.ttc >= 1.5 ? colors.warning : colors.error}
                  />
                </div>
              </div>

              {/* Drag handle */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  color: colors.textDim,
                  flexShrink: 0,
                  cursor: "grab",
                }}
              >
                <GripVertical size={22} />
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Preference Summary ─────────────────────────────────────── */}
      <div
        style={{
          ...glass,
          width: "100%",
          maxWidth: 680,
          marginTop: spacing.xxl,
          padding: spacing.xl,
        }}
      >
        <h2
          style={{
            ...typeScale.h2,
            margin: `0 0 ${spacing.lg}px`,
            display: "flex",
            alignItems: "center",
            gap: spacing.sm,
          }}
        >
          <CheckCircle size={18} color={colors.accent} />
          Preference Summary
        </h2>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: spacing.sm,
          }}
        >
          {cards.map((card, idx) => {
            const m = metrics[card.variant];
            return (
              <div
                key={card.variant}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: spacing.sm,
                  padding: `${spacing.sm}px ${spacing.md}px`,
                  borderRadius: radius.sm,
                  background:
                    idx === 0 ? `${card.color}14` : "transparent",
                }}
              >
                <span
                  style={{
                    ...typeScale.mono,
                    color: idx === 0 ? card.color : colors.textDim,
                    width: 32,
                    flexShrink: 0,
                  }}
                >
                  {RANK_LABELS[idx]}:
                </span>
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: card.color,
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    ...typeScale.body,
                    color: idx === 0 ? colors.textPrimary : colors.textSecondary,
                  }}
                >
                  {card.label}
                </span>
                <span
                  style={{
                    ...typeScale.small,
                    color: colors.textDim,
                    marginLeft: "auto",
                  }}
                >
                  reward: {fmtReward(m.reward)}, safety:{" "}
                  {fmtSafety(m.safety)}
                </span>
              </div>
            );
          })}
        </div>

        <p
          style={{
            ...typeScale.small,
            color: colors.textSecondary,
            marginTop: spacing.lg,
            marginBottom: 0,
            padding: `${spacing.sm}px ${spacing.md}px`,
            background: colors.bgSurface,
            borderRadius: radius.sm,
            border: `1px solid ${colors.border}`,
          }}
        >
          This ranking produces{" "}
          <span style={{ color: colors.accent, fontWeight: 600 }}>
            {PAIR_COUNT} pairwise comparisons
          </span>{" "}
          for GRPO training
        </p>
      </div>

      {/* ── Submit button ──────────────────────────────────────────── */}
      <button
        onClick={handleSubmit}
        disabled={submitted}
        style={{
          marginTop: spacing.xxl,
          padding: `${spacing.md + 2}px ${spacing.xxl + 8}px`,
          border: "none",
          borderRadius: radius.lg,
          background: submitted
            ? colors.bgSurface
            : "linear-gradient(135deg, #00E89D, #00C9DB)",
          color: submitted ? colors.textSecondary : colors.bgDeep,
          fontFamily: fonts.sans,
          fontSize: 15,
          fontWeight: 600,
          cursor: submitted ? "default" : "pointer",
          display: "flex",
          alignItems: "center",
          gap: spacing.sm,
          transition: "transform 0.15s ease, box-shadow 0.15s ease",
          boxShadow: submitted
            ? "none"
            : "0 4px 24px rgba(0,232,157,0.25)",
        }}
        onMouseEnter={(e) => {
          if (!submitted) {
            (e.currentTarget as HTMLButtonElement).style.transform = "translateY(-1px)";
            (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 6px 32px rgba(0,232,157,0.35)";
          }
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.transform = "none";
          (e.currentTarget as HTMLButtonElement).style.boxShadow = submitted
            ? "none"
            : "0 4px 24px rgba(0,232,157,0.25)";
        }}
      >
        {submitted ? (
          <>
            <CheckCircle size={16} />
            Submitted
          </>
        ) : (
          <>
            Submit Ranking &amp; Continue
            <ArrowRight size={16} />
          </>
        )}
      </button>
    </div>
  );
}

// ── Sub-component ──────────────────────────────────────────────────

function MetricChip({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        ...typeScale.mono,
      }}
    >
      <span style={{ color: colors.textDim }}>{label}</span>
      <span style={{ color: accent, fontWeight: 600 }}>{value}</span>
    </div>
  );
}
