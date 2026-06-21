/**
 * AnalysisPage — Incident forensics with 3D scene replay and LLM analysis.
 *
 * Three-column layout:
 *   LEFT:   Scrollable incident list with severity indicators
 *   CENTER: Scene3D replay + Timeline scrubber
 *   RIGHT:  AI-generated analysis panel + metric cards
 *
 * Bottom: "Start Review" CTA that advances to the comparison stage.
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  Sparkles,
  ArrowRight,
  Clock,
  Shield,
  Activity,
  Gauge,
} from "lucide-react";
import Scene3D from "../components/Scene3D";
import Timeline from "../components/Timeline";
import { useStore } from "../store";
import { colors, fonts, typeScale, spacing, glass, radius } from "../theme";
import { analyzeIncident } from "../lib/llmClient";
import type { Incident, Severity } from "../lib/types";

// ---------------------------------------------------------------------------
// Severity color map
// ---------------------------------------------------------------------------

const SEVERITY_COLORS: Record<Severity, string> = {
  critical: "#EF4444",
  high: "#F5A623",
  medium: "#FFB020",
  low: colors.textDim,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Render markdown-ish analysis text: **bold**, paragraph breaks. */
function renderAnalysis(text: string): React.ReactNode[] {
  return text.split("\n\n").map((paragraph, pi) => {
    const parts: React.ReactNode[] = [];
    const regex = /\*\*(.+?)\*\*/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(paragraph)) !== null) {
      if (match.index > lastIndex) {
        parts.push(paragraph.slice(lastIndex, match.index));
      }
      parts.push(
        <span key={`${pi}-${match.index}`} style={{ fontWeight: 700, color: colors.textPrimary }}>
          {match[1]}
        </span>,
      );
      lastIndex = regex.lastIndex;
    }
    if (lastIndex < paragraph.length) {
      parts.push(paragraph.slice(lastIndex));
    }

    return (
      <p
        key={pi}
        style={{
          margin: 0,
          marginBottom: spacing.md,
          ...typeScale.body,
          fontFamily: fonts.sans,
          color: colors.textSecondary,
          lineHeight: 1.65,
        }}
      >
        {parts}
      </p>
    );
  });
}

/** Human-readable incident type badge. */
function typeLabel(type: string): string {
  return type
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AnalysisPage() {
  const navigate = useNavigate();

  // Store selectors
  const incidents = useStore((s) => s.incidents);
  const selectedIncidentIndex = useStore((s) => s.selectedIncidentIndex);
  const scenarioId = useStore((s) => s.scenarioId);
  const actions = useStore((s) => s.actions);

  // Local loading state for the LLM call
  const [analysisLoading, setAnalysisLoading] = useState(false);

  // Track which incident IDs we've already kicked off analysis for
  const analysisRequested = useRef<Set<string>>(new Set());

  const selectedIncident: Incident | null = incidents[selectedIncidentIndex] ?? null;

  // ── Auto-select first incident on mount ──────────────────────────────
  useEffect(() => {
    if (incidents.length > 0) {
      actions.setSelectedIncidentIndex(0);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Trigger LLM analysis when the selected incident changes ──────────
  useEffect(() => {
    if (!selectedIncident) return;
    if (selectedIncident.llmAnalysis) return;
    if (analysisRequested.current.has(selectedIncident.id)) return;

    analysisRequested.current.add(selectedIncident.id);
    setAnalysisLoading(true);

    analyzeIncident(selectedIncident, scenarioId)
      .then((text) => {
        actions.updateIncidentAnalysis(selectedIncident.id, text);
      })
      .catch(() => {
        // Swallow — the mock fallback in llmClient already covers this.
      })
      .finally(() => {
        setAnalysisLoading(false);
      });
  }, [selectedIncident?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Incident card click ──────────────────────────────────────────────
  const handleSelectIncident = useCallback(
    (idx: number) => {
      actions.setSelectedIncidentIndex(idx);
      const inc = incidents[idx];
      if (inc) {
        actions.setFrame(inc.frameIndex);
      }
    },
    [incidents, actions],
  );

  // ── Navigate to compare stage ────────────────────────────────────────
  const handleStartReview = useCallback(() => {
    actions.setPipelineStage("compare");
    navigate("/compare");
  }, [actions, navigate]);

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        background: colors.bgDeep,
        fontFamily: fonts.sans,
        overflow: "hidden",
      }}
    >
      {/* ── Main 3-column area ─────────────────────────────────────── */}
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* ── LEFT SIDEBAR — Incident List ──────────────────────────── */}
        <div
          style={{
            width: 280,
            minWidth: 280,
            display: "flex",
            flexDirection: "column",
            ...glass,
            borderRadius: 0,
            borderRight: `1px solid ${colors.border}`,
            borderTop: "none",
            borderBottom: "none",
            borderLeft: "none",
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: `${spacing.lg}px ${spacing.lg}px ${spacing.md}px`,
              borderBottom: `1px solid ${colors.border}`,
              display: "flex",
              alignItems: "center",
              gap: spacing.sm,
            }}
          >
            <AlertTriangle size={16} color={colors.warning} />
            <span style={{ ...typeScale.h3, color: colors.textPrimary }}>
              Incidents Detected
            </span>
            <span
              style={{
                ...typeScale.caption,
                background: colors.accentDim,
                color: colors.accent,
                padding: `2px ${spacing.sm}px`,
                borderRadius: radius.pill,
                marginLeft: "auto",
              }}
            >
              {incidents.length}
            </span>
          </div>

          {/* Scrollable list */}
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: spacing.sm,
            }}
          >
            {incidents.length === 0 && (
              <div
                style={{
                  padding: spacing.xl,
                  textAlign: "center",
                  color: colors.textDim,
                  ...typeScale.body,
                }}
              >
                No incidents detected yet.
              </div>
            )}

            {incidents.map((inc, idx) => {
              const isActive = idx === selectedIncidentIndex;
              return (
                <div
                  key={inc.id}
                  onClick={() => handleSelectIncident(idx)}
                  style={{
                    padding: spacing.md,
                    marginBottom: spacing.xs,
                    borderRadius: radius.md,
                    background: isActive ? colors.bgOverlay : "transparent",
                    border: isActive
                      ? `1px solid ${colors.accent}`
                      : `1px solid transparent`,
                    boxShadow: isActive
                      ? `0 0 12px ${colors.accentGlow}, inset 0 0 12px ${colors.accentGlow}`
                      : "none",
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) {
                      (e.currentTarget as HTMLDivElement).style.background = colors.bgHover;
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) {
                      (e.currentTarget as HTMLDivElement).style.background = "transparent";
                    }
                  }}
                >
                  {/* Top row: severity dot + title + time */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: spacing.sm,
                      marginBottom: spacing.xs,
                    }}
                  >
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: SEVERITY_COLORS[inc.severity],
                        flexShrink: 0,
                        boxShadow: `0 0 6px ${SEVERITY_COLORS[inc.severity]}80`,
                      }}
                    />
                    <span
                      style={{
                        ...typeScale.h3,
                        color: colors.textPrimary,
                        flex: 1,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {inc.title}
                    </span>
                    <span
                      style={{
                        ...typeScale.mono,
                        color: colors.textDim,
                        flexShrink: 0,
                      }}
                    >
                      {inc.time.toFixed(1)}s
                    </span>
                  </div>

                  {/* Type badge */}
                  <div style={{ marginBottom: spacing.xs }}>
                    <span
                      style={{
                        ...typeScale.caption,
                        background: `${SEVERITY_COLORS[inc.severity]}18`,
                        color: SEVERITY_COLORS[inc.severity],
                        padding: `2px ${spacing.sm}px`,
                        borderRadius: radius.pill,
                        border: `1px solid ${SEVERITY_COLORS[inc.severity]}30`,
                      }}
                    >
                      {typeLabel(inc.type)}
                    </span>
                  </div>

                  {/* Metrics row */}
                  <div
                    style={{
                      display: "flex",
                      gap: spacing.md,
                      ...typeScale.mono,
                      color: colors.textDim,
                    }}
                  >
                    <span>TTC {inc.metrics.ttc.toFixed(1)}s</span>
                    <span>{inc.metrics.minClearance.toFixed(1)}m</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── CENTER — 3D Scene + Timeline ──────────────────────────── */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            position: "relative",
            minWidth: 0,
          }}
        >
          {/* 3D Scene */}
          <div style={{ flex: 1, position: "relative", minHeight: 0 }}>
            <Scene3D />
          </div>

          {/* Timeline at bottom */}
          <div
            style={{
              position: "relative",
              zIndex: 10,
            }}
          >
            <Timeline />
          </div>
        </div>

        {/* ── RIGHT SIDEBAR — AI Analysis ───────────────────────────── */}
        <div
          style={{
            width: 340,
            minWidth: 340,
            display: "flex",
            flexDirection: "column",
            ...glass,
            borderRadius: 0,
            borderLeft: `1px solid ${colors.border}`,
            borderTop: "none",
            borderBottom: "none",
            borderRight: "none",
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: `${spacing.lg}px ${spacing.lg}px ${spacing.md}px`,
              borderBottom: `1px solid ${colors.border}`,
              display: "flex",
              alignItems: "center",
              gap: spacing.sm,
            }}
          >
            <Sparkles size={16} color={colors.accent} />
            <span style={{ ...typeScale.h3, color: colors.textPrimary }}>
              AI Analysis
            </span>
          </div>

          {/* Analysis content */}
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: spacing.lg,
            }}
          >
            {/* No selection placeholder */}
            {!selectedIncident && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  height: "100%",
                  color: colors.textDim,
                  textAlign: "center",
                  gap: spacing.md,
                }}
              >
                <AlertTriangle size={32} color={colors.textMuted} />
                <span style={{ ...typeScale.body }}>
                  Select an incident to analyze
                </span>
              </div>
            )}

            {/* Loading state */}
            {selectedIncident && !selectedIncident.llmAnalysis && analysisLoading && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  height: "100%",
                  gap: spacing.md,
                }}
              >
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: "50%",
                    background: colors.accentGlow,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    animation: "pulse 1.5s ease-in-out infinite",
                  }}
                >
                  <Sparkles size={20} color={colors.accent} />
                </div>
                <span style={{ ...typeScale.body, color: colors.textDim }}>
                  Analyzing incident...
                </span>
                <style>{`
                  @keyframes pulse {
                    0%, 100% { opacity: 0.5; transform: scale(1); }
                    50% { opacity: 1; transform: scale(1.1); }
                  }
                `}</style>
              </div>
            )}

            {/* Analysis text */}
            {selectedIncident?.llmAnalysis && (
              <div>{renderAnalysis(selectedIncident.llmAnalysis)}</div>
            )}
          </div>

          {/* Metrics panel */}
          {selectedIncident && (
            <div
              style={{
                padding: spacing.lg,
                borderTop: `1px solid ${colors.border}`,
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: spacing.sm,
                }}
              >
                {/* TTC */}
                <div
                  style={{
                    background: colors.bgSurface,
                    borderRadius: radius.md,
                    padding: spacing.md,
                    border: `1px solid ${colors.borderSubtle}`,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: spacing.xs,
                      marginBottom: spacing.xs,
                    }}
                  >
                    <Clock size={12} color={colors.textDim} />
                    <span style={{ ...typeScale.caption, color: colors.textDim }}>
                      TTC
                    </span>
                  </div>
                  <span
                    style={{
                      ...typeScale.h2,
                      color: colors.textPrimary,
                      fontFamily: fonts.mono,
                    }}
                  >
                    {selectedIncident.metrics.ttc.toFixed(1)}
                    <span style={{ ...typeScale.small, color: colors.textDim, marginLeft: 2 }}>
                      s
                    </span>
                  </span>
                </div>

                {/* Deceleration */}
                <div
                  style={{
                    background: colors.bgSurface,
                    borderRadius: radius.md,
                    padding: spacing.md,
                    border: `1px solid ${colors.borderSubtle}`,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: spacing.xs,
                      marginBottom: spacing.xs,
                    }}
                  >
                    <Activity size={12} color={colors.textDim} />
                    <span style={{ ...typeScale.caption, color: colors.textDim }}>
                      Deceleration
                    </span>
                  </div>
                  <span
                    style={{
                      ...typeScale.h2,
                      color: colors.textPrimary,
                      fontFamily: fonts.mono,
                    }}
                  >
                    {selectedIncident.metrics.deceleration.toFixed(1)}
                    <span style={{ ...typeScale.small, color: colors.textDim, marginLeft: 2 }}>
                      m/s²
                    </span>
                  </span>
                </div>

                {/* Clearance */}
                <div
                  style={{
                    background: colors.bgSurface,
                    borderRadius: radius.md,
                    padding: spacing.md,
                    border: `1px solid ${colors.borderSubtle}`,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: spacing.xs,
                      marginBottom: spacing.xs,
                    }}
                  >
                    <Shield size={12} color={colors.textDim} />
                    <span style={{ ...typeScale.caption, color: colors.textDim }}>
                      Clearance
                    </span>
                  </div>
                  <span
                    style={{
                      ...typeScale.h2,
                      color: colors.textPrimary,
                      fontFamily: fonts.mono,
                    }}
                  >
                    {selectedIncident.metrics.minClearance.toFixed(1)}
                    <span style={{ ...typeScale.small, color: colors.textDim, marginLeft: 2 }}>
                      m
                    </span>
                  </span>
                </div>

                {/* Ego Speed */}
                <div
                  style={{
                    background: colors.bgSurface,
                    borderRadius: radius.md,
                    padding: spacing.md,
                    border: `1px solid ${colors.borderSubtle}`,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: spacing.xs,
                      marginBottom: spacing.xs,
                    }}
                  >
                    <Gauge size={12} color={colors.textDim} />
                    <span style={{ ...typeScale.caption, color: colors.textDim }}>
                      Ego Speed
                    </span>
                  </div>
                  <span
                    style={{
                      ...typeScale.h2,
                      color: colors.textPrimary,
                      fontFamily: fonts.mono,
                    }}
                  >
                    {selectedIncident.metrics.egoSpeed.toFixed(1)}
                    <span style={{ ...typeScale.small, color: colors.textDim, marginLeft: 2 }}>
                      m/s
                    </span>
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Bottom CTA bar ──────────────────────────────────────────── */}
      <div
        style={{
          padding: `${spacing.md}px ${spacing.xl}px`,
          borderTop: `1px solid ${colors.border}`,
          background: glass.background,
          backdropFilter: glass.backdropFilter,
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
        }}
      >
        <button
          onClick={handleStartReview}
          disabled={incidents.length === 0}
          style={{
            display: "flex",
            alignItems: "center",
            gap: spacing.sm,
            padding: `${spacing.md}px ${spacing.xl}px`,
            borderRadius: radius.md,
            border: "none",
            background: incidents.length > 0 ? colors.accent : colors.bgOverlay,
            color: incidents.length > 0 ? colors.bgDeep : colors.textDim,
            fontFamily: fonts.sans,
            ...typeScale.h3,
            cursor: incidents.length > 0 ? "pointer" : "not-allowed",
            opacity: incidents.length === 0 ? 0.5 : 1,
            transition: "all 0.15s ease",
          }}
          onMouseEnter={(e) => {
            if (incidents.length > 0) {
              (e.currentTarget as HTMLButtonElement).style.boxShadow = `0 0 20px ${colors.accentDim}`;
            }
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.boxShadow = "none";
          }}
        >
          {incidents.length > 0
            ? `Review ${incidents.length} incident${incidents.length !== 1 ? "s" : ""}`
            : "No incidents to review"}
          <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
}
