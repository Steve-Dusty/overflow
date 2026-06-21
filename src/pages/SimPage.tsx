/**
 * SimPage — Main 3D simulator view.
 * Keeps the Three.js renderer intact; replaces surrounding UI with clean panels.
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  LayoutGrid,
  GitBranch,
  Settings2,
  ChevronDown,
  Clock,
  X,
} from "lucide-react";
import Scene3D from "../components/Scene3D";
import Timeline from "../components/Timeline";
import { useStore } from "../store";
import { colors, fonts, typeScale, spacing, glass } from "../theme";
import type { ScenarioId } from "../mockData";
import { SCENARIO_INFO, SCENE_OBSERVATIONS } from "../mockData";
import type { SceneObservation } from "../mockData";
import { generateTrajectoryMoments } from "../utils/trajectoryData";
import { loadScenario } from "../utils/scenarioLoader";

const SCENARIOS: { id: ScenarioId | "full_driving"; label: string }[] = [
  { id: "normal", label: "Normal Traffic" },
  { id: "near_miss", label: "Near Miss" },
  { id: "rear_end", label: "Rear End" },
  { id: "jaywalker", label: "Jaywalker" },
  { id: "red_light_runner", label: "Red Light Runner" },
  { id: "swerving_vehicle", label: "Swerving Vehicle" },
  { id: "final_model", label: "Final Model" },
  { id: "full_driving", label: "Full Driving" },
];

export default function SimPage() {
  const navigate = useNavigate();
  const [showSettings, setShowSettings] = useState(false);

  const dataSource = useStore((s) => s.dataSource);
  const scenarioId = useStore((s) => s.scenarioId);
  const actions = useStore((s) => s.actions);
  const colormapMode = useStore((s) => s.colormapMode);
  const boxMode = useStore((s) => s.boxMode);
  const showGrid = useStore((s) => s.showGrid);
  const pointOpacity = useStore((s) => s.pointOpacity);
  const currentFrameIndex = useStore((s) => s.currentFrameIndex);
  const totalFrames = useStore((s) => s.totalFrames);
  const fps = useStore((s) => s.sceneData?.fps ?? 10);
  const isPlaying = useStore((s) => s.isPlaying);

  const switchScenario = useCallback((id: ScenarioId | "full_driving") => {
    if (id === "full_driving") {
      actions.reset();
      actions.setDataSource("waymo");
      return;
    }
    // Instant switch — loadScenario returns from in-memory cache
    loadScenario(id).then((sceneData) => {
      actions.setScenarioId(id);
      actions.setDataSource("scenario");
      actions.setSceneData(sceneData);
      actions.setCustomIncident(null);
      const moments = generateTrajectoryMoments(sceneData);
      actions.setTrajectoryMoments(moments);
    });
  }, [actions]);

  const currentTime = (currentFrameIndex / fps).toFixed(1);

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      {/* 3D Canvas — THE renderer, untouched */}
      <Scene3D />

      {/* ── Top Bar ── */}
      <div style={{
        position: "absolute",
        top: 48,
        left: spacing.md,
        right: spacing.md,
        zIndex: 20,
        display: "flex",
        alignItems: "center",
        gap: spacing.sm,
        pointerEvents: "none",
      }}>
        {/* Scenario selector */}
        <div style={{ pointerEvents: "auto", position: "relative" }}>
          <ScenarioSelector
            current={scenarioId}
            dataSource={dataSource}
            onSelect={switchScenario}
          />
        </div>

        {/* Timestamp */}
        <div style={{
          ...glass,
          padding: "6px 12px",
          display: "flex",
          alignItems: "center",
          gap: 6,
          pointerEvents: "auto",
        }}>
          <Clock size={12} color={colors.textDim} />
          <span style={{ ...typeScale.mono, color: colors.textSecondary }}>
            {currentTime}s
          </span>
          <span style={{ ...typeScale.mono, color: colors.textDim }}>
            F{currentFrameIndex + 1}/{totalFrames}
          </span>
        </div>

        <div style={{ flex: 1 }} />

        {/* Quick nav buttons */}
        <NavButton icon={LayoutGrid} label="Dashboard" onClick={() => navigate("/dashboard")} />
        <NavButton icon={GitBranch} label="Graph" onClick={() => navigate("/graph")} />

        {/* Settings toggle */}
        <div style={{ pointerEvents: "auto" }}>
          <button
            onClick={() => setShowSettings(!showSettings)}
            style={{
              ...glass,
              padding: "6px 10px",
              display: "flex",
              alignItems: "center",
              gap: 5,
              cursor: "pointer",
              border: `1px solid ${showSettings ? colors.borderAccent : colors.border}`,
            }}
          >
            <Settings2 size={13} color={showSettings ? colors.accent : colors.textSecondary} />
            <span style={{ ...typeScale.small, color: colors.textSecondary }}>View</span>
          </button>
        </div>
      </div>

      {/* ── Settings panel (small floating) ── */}
      {showSettings && (
        <div style={{
          position: "absolute",
          top: 92,
          right: spacing.md,
          zIndex: 25,
          ...glass,
          padding: spacing.md,
          width: 200,
          display: "flex",
          flexDirection: "column",
          gap: spacing.sm,
        }}>
          <div style={{ ...typeScale.caption, color: colors.textDim, marginBottom: 2 }}>Display</div>
          <SettingRow label="Colormap">
            <select
              value={colormapMode}
              onChange={(e) => actions.setColormapMode(e.target.value as "intensity" | "range" | "elongation")}
              style={selectStyle}
            >
              <option value="intensity">Intensity</option>
              <option value="range">Range</option>
              <option value="elongation">Elongation</option>
            </select>
          </SettingRow>
          <SettingRow label="Objects">
            <select
              value={boxMode}
              onChange={(e) => actions.setBoxMode(e.target.value as "off" | "box" | "model")}
              style={selectStyle}
            >
              <option value="box">Wireframe</option>
              <option value="model">3D Models</option>
              <option value="off">Hidden</option>
            </select>
          </SettingRow>
          <SettingRow label="Opacity">
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={pointOpacity}
              onChange={(e) => actions.setPointOpacity(parseFloat(e.target.value))}
              style={{ width: 80 }}
            />
          </SettingRow>
          <SettingRow label="Grid">
            <button
              onClick={() => actions.toggleGrid()}
              style={{
                padding: "2px 8px",
                borderRadius: 4,
                background: showGrid ? "rgba(0,232,157,0.1)" : "rgba(255,255,255,0.04)",
                color: showGrid ? colors.accent : colors.textDim,
                border: `1px solid ${showGrid ? colors.borderAccent : colors.border}`,
                fontSize: 10,
                cursor: "pointer",
              }}
            >
              {showGrid ? "On" : "Off"}
            </button>
          </SettingRow>
          <SettingRow label="Source">
            <div style={{ display: "flex", gap: 2 }}>
              {(["scenario", "waymo"] as const).map((src) => (
                <button
                  key={src}
                  onClick={() => {
                    if (src === "scenario") {
                      loadScenario(scenarioId).then((sceneData) => {
                        actions.setDataSource("scenario");
                        actions.setSceneData(sceneData);
                        const moments = generateTrajectoryMoments(sceneData);
                        actions.setTrajectoryMoments(moments);
                      });
                    } else {
                      actions.reset();
                      actions.setDataSource(src);
                    }
                  }}
                  style={{
                    padding: "2px 7px",
                    borderRadius: 3,
                    fontSize: 9,
                    fontFamily: fonts.mono,
                    background: dataSource === src || (src === "scenario" && dataSource === "scenario") ? "rgba(0,232,157,0.1)" : "transparent",
                    color: dataSource === src || (src === "scenario" && dataSource === "scenario") ? colors.accent : colors.textDim,
                    border: `1px solid ${dataSource === src ? colors.borderAccent : "transparent"}`,
                    cursor: "pointer",
                  }}
                >
                  {src === "scenario" ? "scenarios" : "waymo"}
                </button>
              ))}
            </div>
          </SettingRow>
        </div>
      )}

      {/* ── Right panel: Streaming observation log ── */}
      <ObservationLog
        scenarioId={scenarioId}
        currentTime={parseFloat(currentTime)}
        isPlaying={isPlaying}
      />

      {/* Timeline (bottom) — reused from existing */}
      <Timeline />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ScenarioSelector({
  current,
  dataSource,
  onSelect,
}: {
  current: ScenarioId;
  dataSource: string;
  onSelect: (id: ScenarioId | "full_driving") => void;
}) {
  const [open, setOpen] = useState(false);
  const isWaymo = dataSource === "waymo" || dataSource === "waymo-drop";
  const label = isWaymo
    ? "Full Driving"
    : SCENARIOS.find((s) => s.id === current)?.label || current;

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          ...glass,
          padding: "6px 12px",
          display: "flex",
          alignItems: "center",
          gap: 6,
          cursor: "pointer",
          border: `1px solid ${open ? colors.borderAccent : colors.border}`,
        }}
      >
        <span style={{ ...typeScale.small, color: colors.textPrimary, fontWeight: 500 }}>
          {label}
        </span>
        <ChevronDown size={12} color={colors.textDim} />
      </button>
      {open && (
        <div style={{
          position: "absolute",
          top: "calc(100% + 4px)",
          left: 0,
          ...glass,
          padding: 4,
          minWidth: 180,
          zIndex: 100,
        }}>
          {SCENARIOS.map((s, i) => {
            const isActive = s.id === "full_driving"
              ? isWaymo
              : !isWaymo && s.id === current;
            const isFullDriving = s.id === "full_driving";
            return (
              <div key={s.id}>
                {isFullDriving && (
                  <div style={{
                    height: 1,
                    background: "rgba(255,255,255,0.08)",
                    margin: "4px 6px",
                  }} />
                )}
                <button
                  onClick={() => { onSelect(s.id); setOpen(false); }}
                  style={{
                    display: "block",
                    width: "100%",
                    padding: "6px 10px",
                    borderRadius: 6,
                    fontSize: 12,
                    textAlign: "left",
                    color: isActive ? colors.accent : colors.textSecondary,
                    background: isActive ? "rgba(0,232,157,0.06)" : "transparent",
                    border: "none",
                    cursor: "pointer",
                    fontFamily: fonts.sans,
                  }}
                >
                  {s.label}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ObservationLog({
  scenarioId,
  currentTime,
  isPlaying,
}: {
  scenarioId: ScenarioId;
  currentTime: number;
  isPlaying: boolean;
}) {
  const observations = SCENE_OBSERVATIONS[scenarioId] ?? [];
  const scrollRef = useRef<HTMLDivElement>(null);

  // Get all observations that should be visible at the current time
  const visible = observations.filter((o) => o.time <= currentTime);

  // Auto-scroll to bottom when new entries appear
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [visible.length]);

  const sevColor = (sev: SceneObservation["severity"]) =>
    sev === "danger" ? "#FF4444" : sev === "caution" ? "#FFB020" : colors.textDim;

  return (
    <div style={{
      position: "absolute",
      right: spacing.md,
      top: "30%",
      zIndex: 20,
      width: 320,
      maxHeight: "calc(100vh - 280px)",
      display: "flex",
      flexDirection: "column",
      pointerEvents: "none",
    }}>
      {/* Header label */}
      <div style={{
        fontFamily: fonts.mono,
        fontSize: 9,
        fontWeight: 600,
        color: colors.textDim,
        letterSpacing: "1.5px",
        textTransform: "uppercase",
        marginBottom: 6,
        textAlign: "right",
        pointerEvents: "auto",
      }}>
        scene analysis
      </div>

      {/* Log entries */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 2,
          maskImage: "linear-gradient(to bottom, transparent 0%, black 8%, black 100%)",
          WebkitMaskImage: "linear-gradient(to bottom, transparent 0%, black 8%, black 100%)",
        }}
      >
        {visible.length === 0 && (
          <div style={{
            fontFamily: fonts.mono,
            fontSize: 10,
            color: colors.textDim,
            textAlign: "right",
            padding: "8px 0",
            opacity: 0.6,
          }}>
            {isPlaying ? "initializing scan..." : "press play to begin"}
          </div>
        )}

        {visible.map((obs, i) => {
          const isLatest = i === visible.length - 1;
          const c = sevColor(obs.severity);

          return (
            <div
              key={`${obs.time}-${i}`}
              style={{
                display: "flex",
                gap: 8,
                alignItems: "flex-start",
                opacity: isLatest ? 1 : 0.45,
                transition: "opacity 0.3s ease",
              }}
            >
              {/* Timestamp */}
              <span style={{
                fontFamily: fonts.mono,
                fontSize: 9,
                color: colors.textDim,
                flexShrink: 0,
                width: 32,
                textAlign: "right",
                marginTop: 1,
                opacity: 0.7,
              }}>
                {obs.time.toFixed(1)}s
              </span>

              {/* Severity dot */}
              <span style={{
                width: 5,
                height: 5,
                borderRadius: "50%",
                background: c,
                flexShrink: 0,
                marginTop: 4,
                boxShadow: obs.severity !== "nominal" && isLatest
                  ? `0 0 6px ${c}80`
                  : "none",
              }} />

              {/* Message */}
              <span style={{
                fontFamily: fonts.mono,
                fontSize: 10,
                color: isLatest
                  ? (obs.severity === "danger" ? "#FF6B6B" : obs.severity === "caution" ? "#FFD93D" : colors.textSecondary)
                  : colors.textDim,
                lineHeight: 1.5,
                fontWeight: isLatest ? 500 : 400,
              }}>
                {obs.message}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function NavButton({ icon: Icon, label, onClick }: { icon: typeof LayoutGrid; label: string; onClick: () => void }) {
  return (
    <div style={{ pointerEvents: "auto" }}>
      <button
        onClick={onClick}
        style={{
          ...glass,
          padding: "6px 10px",
          display: "flex",
          alignItems: "center",
          gap: 5,
          cursor: "pointer",
        }}
      >
        <Icon size={13} color={colors.textSecondary} />
        <span style={{ ...typeScale.small, color: colors.textSecondary }}>{label}</span>
      </button>
    </div>
  );
}

function SettingRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
    }}>
      <span style={{ ...typeScale.small, color: colors.textSecondary }}>{label}</span>
      {children}
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.04)",
  border: `1px solid ${colors.border}`,
  borderRadius: 4,
  color: colors.textSecondary,
  fontSize: 10,
  fontFamily: fonts.mono,
  padding: "2px 6px",
  outline: "none",
};
