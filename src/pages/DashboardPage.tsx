/**
 * DashboardPage — 2×2 grid of pre-generated scenario variants.
 *
 * Layout:
 *   Top-left: Ground Truth (worst outcome — from global store)
 *   Top-right: Avoid Left variant
 *   Bottom-left: Avoid Right variant
 *   Bottom-right: Emergency Brake variant
 *
 * All tiles have independent playback. Variants are pre-generated and
 * loaded from static files — no runtime counterfactual spawning.
 */

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Play,
  Pause,
  Maximize2,
  RotateCcw,
} from "lucide-react";
import Scene3D from "../components/Scene3D";
import SceneBoundary from "../components/SceneBoundary";
import Timeline from "../components/Timeline";
import Badge from "../components/ui/Badge";
import { useStore } from "../store";
import { SCENARIO_INFO, VARIANT_INFO, VARIANT_METRICS } from "../mockData";
import type { SceneData, SceneVariant, VariantMetrics } from "../mockData";
import type { FrameOverrideHolder } from "../components/FrameOverrideContext";
import { loadScenarioVariants } from "../utils/scenarioLoader";
import { colors, fonts, typeScale, spacing, glass, radius } from "../theme";

// Variants to show in counterfactual tiles (order matters for grid layout)
const CF_VARIANTS: SceneVariant[] = ["avoid_left", "avoid_right", "emergency_brake"];
const TILE_COLORS = ["#4ECDC4", "#FFD93D", "#FF6B6B"];

export default function DashboardPage() {
  const navigate = useNavigate();
  const scenarioId = useStore((s) => s.scenarioId);
  const isPlaying = useStore((s) => s.isPlaying);
  const actions = useStore((s) => s.actions);

  const [variants, setVariants] = useState<Record<SceneVariant, SceneData> | null>(null);
  const [loading, setLoading] = useState(true);

  // Load all 4 variants for the current scenario
  useEffect(() => {
    setLoading(true);
    loadScenarioVariants(scenarioId).then((v) => {
      setVariants(v);
      setLoading(false);
    });
  }, [scenarioId]);

  // Auto-play everything when entering the dashboard
  useEffect(() => {
    actions.setPlaying(true);
  }, []);

  const scenarioMeta = SCENARIO_INFO[scenarioId];

  if (loading || !variants) {
    return (
      <div style={{
        height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
        flexDirection: "column", gap: 12,
      }}>
        <div style={{
          width: 24, height: 24,
          border: `2px solid ${colors.accent}`,
          borderTopColor: "transparent",
          borderRadius: "50%",
          animation: "spin 0.7s linear infinite",
        }} />
        <span style={{ ...typeScale.mono, color: colors.textDim }}>
          Loading variants for "{scenarioMeta.label}"…
        </span>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div style={{
      height: "100%",
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
      position: "relative",
    }}>
      {/* Header */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: `${spacing.sm}px ${spacing.lg}px`,
        flexShrink: 0,
        borderBottom: `1px solid ${colors.border}`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: spacing.md }}>
          <h1 style={{ ...typeScale.h2, color: colors.textPrimary, margin: 0 }}>
            {scenarioMeta.label}
          </h1>
          <Badge
            variant={scenarioMeta.severity === "critical" ? "error" : scenarioMeta.severity === "warning" ? "warning" : "success"}
            dot
          >
            {scenarioMeta.severity}
          </Badge>
          <span style={{ ...typeScale.small, color: colors.textDim }}>
            Multi-Sim Dashboard
          </span>
        </div>
        <div style={{ display: "flex", gap: spacing.sm, alignItems: "center" }}>
          <button onClick={() => actions.togglePlay()} style={headerBtn}>
            {isPlaying ? <Pause size={13} /> : <Play size={13} />}
            <span style={{ fontSize: 11 }}>{isPlaying ? "Pause All" : "Play All"}</span>
          </button>
        </div>
      </div>

      {/* Main grid */}
      <div style={{
        flex: 1,
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gridTemplateRows: "1fr 1fr",
        gap: spacing.sm,
        padding: spacing.sm,
        overflow: "hidden",
        paddingBottom: 68,
      }}>
        {/* Ground truth tile — top-left, uses global store */}
        <div style={{
          background: colors.bgCard,
          border: `1px solid ${colors.borderAccent}`,
          borderRadius: radius.lg,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          position: "relative",
        }}>
          <TileHeader
            title="Ground Truth"
            right={
              <button onClick={() => navigate("/sim")} style={tileBtn}>
                <Maximize2 size={12} />
              </button>
            }
          />
          <div style={{ flex: 1, position: "relative", background: colors.bgDeep, minHeight: 0 }}>
            <SceneBoundary label="dashboard-ground-truth" resetKey={scenarioId}>
              <Scene3D />
            </SceneBoundary>
          </div>
        </div>

        {/* 3 counterfactual variant tiles */}
        {CF_VARIANTS.map((variant, i) => (
          <VariantTile
            key={variant}
            sceneData={variants[variant]}
            variant={variant}
            tileColor={TILE_COLORS[i]}
            metrics={VARIANT_METRICS[scenarioId][variant]}
          />
        ))}
      </div>

      {/* Timeline — drives ground truth playback */}
      <Timeline />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Variant tile — independent playback from pre-generated SceneData
// ---------------------------------------------------------------------------

function VariantTile({
  sceneData,
  variant,
  tileColor,
  metrics,
}: {
  sceneData: SceneData;
  variant: SceneVariant;
  tileColor: string;
  metrics: VariantMetrics;
}) {
  const info = VARIANT_INFO[variant];
  const globalFrameIndex = useStore((s) => s.currentFrameIndex);

  // Stable mutable holder — syncs to global timeline
  const frameHolder = useMemo<FrameOverrideHolder>(() => ({ current: sceneData.frames[0] ?? null }), []);

  // Sync to global store's currentFrameIndex — all tiles follow the same timeline
  useEffect(() => {
    const clamped = Math.min(globalFrameIndex, sceneData.totalFrames - 1);
    frameHolder.current = sceneData.frames[clamped] ?? null;
  }, [globalFrameIndex, sceneData.frames, sceneData.totalFrames, frameHolder]);

  const displayTime = (Math.min(globalFrameIndex, sceneData.totalFrames - 1) / sceneData.fps).toFixed(1);

  const restart = useCallback(() => {
    useStore.getState().actions.setFrame(0);
  }, [sceneData, frameHolder]);

  return (
    <div style={{
      background: colors.bgCard,
      border: `1px solid ${tileColor}33`,
      borderRadius: radius.lg,
      overflow: "hidden",
      display: "flex",
      flexDirection: "column",
      position: "relative",
    }}>
      <TileHeader
        title={info.label}
        subtitle={info.description}
        color={tileColor}
        badge={
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
            color: metrics.status === "optimal"
              ? "#4ECDC4"
              : metrics.status === "dangerous"
              ? "#FF6B6B"
              : "#FFD93D",
          }}>
            R: {metrics.reward > 0 ? "+" : ""}{metrics.reward.toFixed(2)}
          </span>
        }
        right={
          <button onClick={restart} style={tileBtn}>
            <RotateCcw size={11} />
          </button>
        }
      />

      <div style={{ flex: 1, position: "relative", background: colors.bgDeep, minHeight: 0 }}>
        <SceneBoundary label={`dashboard-${variant}`} resetKey={variant}>
          <Scene3D frameOverrideHolder={frameHolder} lite />
        </SceneBoundary>

        {/* Colored border highlight */}
        <div style={{
          position: "absolute", inset: 0,
          border: `2px solid ${tileColor}30`,
          pointerEvents: "none",
        }} />

        {/* Time overlay */}
        <div style={{
          position: "absolute", bottom: 6, left: 6,
          ...typeScale.mono, fontSize: 10,
          color: tileColor,
          background: "rgba(10,13,22,0.88)",
          padding: "2px 8px", borderRadius: 4,
          pointerEvents: "none",
        }}>
          {displayTime}s / {sceneData.totalSeconds.toFixed(1)}s
        </div>

        {/* Metrics overlay */}
        <div style={{
          position: "absolute", bottom: 6, right: 6,
          ...typeScale.mono, fontSize: 9,
          color: colors.textDim,
          background: "rgba(10,13,22,0.88)",
          padding: "3px 8px", borderRadius: 4,
          pointerEvents: "none",
          display: "flex", gap: 8,
        }}>
          <span>Safety: <span style={{ color: metrics.safety > 0.7 ? "#4ECDC4" : metrics.safety > 0.3 ? "#FFD93D" : "#FF6B6B" }}>
            {(metrics.safety * 100).toFixed(0)}%
          </span></span>
          <span>TTC: <span style={{ color: metrics.ttc > 3 ? "#4ECDC4" : metrics.ttc > 1.5 ? "#FFD93D" : "#FF6B6B" }}>
            {metrics.ttc === Infinity ? "∞" : metrics.ttc.toFixed(1) + "s"}
          </span></span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tile header
// ---------------------------------------------------------------------------

function TileHeader({ title, subtitle, badge, right, color }: {
  title: string;
  subtitle?: string;
  badge?: React.ReactNode;
  right?: React.ReactNode;
  color?: string;
}) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: `4px ${spacing.md}px`,
      borderBottom: `1px solid ${colors.border}`,
      flexShrink: 0,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
        {color && (
          <div style={{
            width: 6, height: 6, borderRadius: "50%",
            background: color, flexShrink: 0,
          }} />
        )}
        {title && <span style={{ ...typeScale.small, fontWeight: 600, color: colors.textPrimary }}>{title}</span>}
        {subtitle && (
          <span style={{ ...typeScale.caption, color: colors.textDim, fontSize: 9 }}>{subtitle}</span>
        )}
        {badge}
      </div>
      {right}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const tileBtn: React.CSSProperties = {
  width: 24, height: 24,
  display: "flex", alignItems: "center", justifyContent: "center",
  borderRadius: 4,
  background: "rgba(255,255,255,0.04)",
  border: `1px solid ${colors.border}`,
  color: colors.textSecondary,
  cursor: "pointer", padding: 0,
};

const headerBtn: React.CSSProperties = {
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
