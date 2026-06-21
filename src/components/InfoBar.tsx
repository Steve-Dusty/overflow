/**
 * InfoBar — Floating glass top bar with logo + live stats.
 * Positioned absolute over the 3D canvas.
 */

import { colors, fonts } from "../theme";
import { useStore } from "../store";
import { SCENARIO_INFO } from "../mockData";

export default function InfoBar() {
  const totalFrames = useStore((s) => s.totalFrames);
  const currentFrameIndex = useStore((s) => s.currentFrameIndex);
  const currentFrame = useStore((s) => s.currentFrame);
  const dataSource = useStore((s) => s.dataSource);
  const scenarioId = useStore((s) => s.scenarioId);
  const pts = currentFrame?.pointCount ?? 0;
  const boxes = currentFrame?.boxes.length ?? 0;
  const customScenarioName = useStore((s) => s.customScenarioName);
  const customSeverity = useStore((s) => s.customSeverity);
  const isScenario = dataSource === "scenario";
  const scenarioInfo = isScenario ? SCENARIO_INFO[scenarioId] : null;
  const displayLabel = customScenarioName ?? scenarioInfo?.label ?? "";
  const displaySeverity = customSeverity ?? scenarioInfo?.severity ?? "none";

  return (
    <div style={{
      position: "absolute",
      top: 0, left: 0, right: 0,
      height: 44,
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "0 16px",
      background: "linear-gradient(180deg, rgba(12,15,26,0.85) 0%, rgba(12,15,26,0.4) 100%)",
      backdropFilter: "blur(16px)",
      borderBottom: "1px solid rgba(255,255,255,0.04)",
      fontFamily: fonts.sans,
      userSelect: "none",
      zIndex: 10,
    }}>
      {/* Left: brand */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{
          width: 7, height: 7,
          borderRadius: "50%",
          background: colors.accent,
          boxShadow: `0 0 10px ${colors.accent}, 0 0 20px rgba(0,232,157,0.2)`,
        }} />
        <span style={{
          fontSize: 13, fontWeight: 700,
          color: colors.textPrimary,
          letterSpacing: "0.6px",
        }}>
          Overflow
        </span>
        <span style={{
          fontSize: 10, fontWeight: 500,
          color: colors.textDim,
          marginLeft: 2,
          letterSpacing: "0.3px",
        }}>
          {isScenario ? scenarioInfo?.label ?? "Scenario" : "Waymo OD v2"}
        </span>
        {isScenario && displaySeverity !== "none" && (
          <span style={{
            fontSize: 9, fontWeight: 700,
            color: displaySeverity === "critical" ? "#FF4444" : "#FFB020",
            background: displaySeverity === "critical" ? "rgba(255,68,68,0.12)" : "rgba(255,176,32,0.12)",
            padding: "2px 8px",
            borderRadius: 4,
            letterSpacing: "0.5px",
            textTransform: "uppercase",
            fontFamily: fonts.mono,
          }}>
            {displayLabel}
          </span>
        )}
      </div>

      {/* Right: stats */}
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        <Stat label="FRAME" value={`${currentFrameIndex + 1}/${totalFrames}`} />
        <Stat label="POINTS" value={pts.toLocaleString()} highlight />
        <Stat label="OBJECTS" value={String(boxes)} />
      </div>
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
      <span style={{
        fontSize: 9, fontWeight: 600,
        color: colors.textDim,
        letterSpacing: "1px",
        fontFamily: fonts.sans,
      }}>
        {label}
      </span>
      <span style={{
        fontSize: 12, fontWeight: 600,
        color: highlight ? colors.accent : colors.textPrimary,
        fontFamily: fonts.mono,
      }}>
        {value}
      </span>
    </div>
  );
}
