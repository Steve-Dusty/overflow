/**
 * IncidentAlert — Floating on-screen alert that appears when the current
 * frame is within a scenario's incident window. Shows severity, description,
 * and pulses at peak danger.
 */

import { useStore } from "../store";
import { SCENARIO_INFO } from "../mockData";
import { colors, fonts } from "../theme";

export default function IncidentAlert() {
  const dataSource = useStore((s) => s.dataSource);
  const scenarioId = useStore((s) => s.scenarioId);
  const currentFrameIndex = useStore((s) => s.currentFrameIndex);
  const fps = useStore((s) => s.sceneData?.fps ?? 10);
  const customIncident = useStore((s) => s.customIncident);
  const customScenarioName = useStore((s) => s.customScenarioName);
  const customSeverity = useStore((s) => s.customSeverity);

  if (dataSource !== "scenario") return null;

  // Use custom incident if present, otherwise use preset scenario
  const meta = SCENARIO_INFO[scenarioId];
  const incident = customIncident ?? meta.incident;
  const severity = customSeverity ?? meta.severity;
  const label = customScenarioName ?? meta.label;

  if (!incident) return null;

  const currentTime = currentFrameIndex / fps;
  const { startTime, endTime, peakTime, description } = incident;

  const isActive = currentTime >= startTime && currentTime <= endTime;
  if (!isActive) return null;

  const isCritical = severity === "critical";
  const sevColor = isCritical ? "#FF4444" : "#FFB020";
  const nearPeak = Math.abs(currentTime - peakTime) < 0.5;

  const incidentProgress = (currentTime - startTime) / (endTime - startTime);

  return (
    <>
      {/* CSS animation for pulse */}
      <style>{`
        @keyframes incidentPulse {
          0%, 100% { opacity: 0.9; transform: translate(-50%, 0) scale(1); }
          50% { opacity: 1; transform: translate(-50%, 0) scale(1.03); }
        }
        @keyframes borderPulse {
          0%, 100% { box-shadow: 0 0 20px ${sevColor}40, inset 0 0 20px ${sevColor}10; }
          50% { box-shadow: 0 0 40px ${sevColor}60, inset 0 0 30px ${sevColor}20; }
        }
        @keyframes iconFlash {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>

      {/* Main alert banner */}
      <div style={{
        position: "absolute",
        top: 56,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "8px 20px",
        background: `linear-gradient(135deg, ${sevColor}18, ${sevColor}08)`,
        backdropFilter: "blur(20px)",
        border: `1px solid ${sevColor}50`,
        borderRadius: 10,
        fontFamily: fonts.sans,
        animation: nearPeak
          ? "incidentPulse 0.6s ease-in-out infinite, borderPulse 0.6s ease-in-out infinite"
          : "borderPulse 2s ease-in-out infinite",
        userSelect: "none",
        whiteSpace: "nowrap",
      }}>
        {/* Warning icon */}
        <div style={{
          width: 24, height: 24,
          display: "flex", alignItems: "center", justifyContent: "center",
          borderRadius: 6,
          background: `${sevColor}25`,
          animation: nearPeak ? "iconFlash 0.4s ease-in-out infinite" : "none",
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 14 }}>
            {isCritical ? "🚨" : "⚠️"}
          </span>
        </div>

        {/* Text */}
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{
              fontSize: 11,
              fontWeight: 700,
              color: sevColor,
              letterSpacing: "0.5px",
              textTransform: "uppercase",
            }}>
              {severity === "critical" ? "CRITICAL" : "WARNING"}
            </span>
            <span style={{
              fontSize: 11,
              fontWeight: 600,
              color: colors.textPrimary,
            }}>
              {label}
            </span>
          </div>
          <span style={{
            fontSize: 9,
            color: colors.textSecondary,
            fontFamily: fonts.mono,
          }}>
            {description} — {currentTime.toFixed(1)}s
          </span>
        </div>

        {/* Severity bar */}
        <div style={{
          width: 60, height: 4,
          background: "rgba(255,255,255,0.1)",
          borderRadius: 2,
          overflow: "hidden",
          flexShrink: 0,
        }}>
          <div style={{
            height: "100%",
            width: `${incidentProgress * 100}%`,
            background: sevColor,
            borderRadius: 2,
            transition: "width 0.1s linear",
          }} />
        </div>
      </div>

      {/* Screen edge vignette (subtle danger framing) */}
      <div style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        zIndex: 5,
        boxShadow: nearPeak
          ? `inset 0 0 80px ${sevColor}20, inset 0 0 200px ${sevColor}08`
          : `inset 0 0 60px ${sevColor}10`,
        transition: "box-shadow 0.3s",
      }} />
    </>
  );
}
