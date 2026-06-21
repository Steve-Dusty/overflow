/**
 * UploadPage — Entry point for Overflow: adversarial scenario generation
 * for autonomous driving. Drag in mock Waymo data, watch a perception-pipeline
 * analysis animation, then navigate to the dashboard with counterfactual variants.
 */

import { useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useStore } from "../store";
import { loadScenario } from "../utils/scenarioLoader";
import { generateTrajectoryMoments } from "../utils/trajectoryData";
import { colors, fonts } from "../theme";
import {
  Upload,
  ArrowRight,
  Database,
  Search,
  AlertTriangle,
  CheckCircle,
} from "lucide-react";
import type { ScenarioId } from "../mockData";

// ---------------------------------------------------------------------------
// Scenario mapping from free-text input
// ---------------------------------------------------------------------------

function classifyScenario(text: string): ScenarioId {
  const t = text.toLowerCase();
  if (t.includes("jaywalk") || t.includes("pedestrian")) return "jaywalker";
  if (t.includes("rear") || t.includes("brake") || t.includes("follow"))
    return "rear_end";
  if (t.includes("red light") || t.includes("intersection"))
    return "red_light_runner";
  if (t.includes("swerv") || t.includes("lane")) return "swerving_vehicle";
  if (t.includes("near miss") || t.includes("close")) return "near_miss";
  if (t.includes("normal") || t.includes("cruise")) return "normal";
  if (t.includes("final") || t.includes("complex") || t.includes("multi")) return "final_model";
  return "near_miss";
}

/** Try to extract scenario info from a parsed JSON file */
function classifyFromFileContent(json: Record<string, unknown>): {
  scenarioId: ScenarioId;
  filename: string;
  agents: number;
  frames: number;
  incident: string | null;
} {
  // Check for scenarioId field directly
  const sid = json.scenarioId as string | undefined;
  if (sid && ["normal","near_miss","rear_end","jaywalker","red_light_runner","swerving_vehicle","final_model"].includes(sid)) {
    const stats = json.stats as Record<string, unknown> | undefined;
    const objs = json.tracked_objects as unknown[] | undefined;
    const framesArr = json.frames as unknown[] | undefined;
    const incidents = json.incidents as { type?: string; description?: string }[] | undefined;
    return {
      scenarioId: sid as ScenarioId,
      filename: (json.segment_id as string) || "unknown",
      agents: objs?.length ?? 0,
      frames: framesArr?.length ?? (stats?.total_frames as number ?? 198),
      incident: incidents?.[0]?.description ?? null,
    };
  }
  // Fallback: classify from filename or content text
  const allText = JSON.stringify(json).toLowerCase();
  return {
    scenarioId: classifyScenario(allText),
    filename: (json.segment_id as string) || "uploaded_scene",
    agents: (json.tracked_objects as unknown[])?.length ?? 0,
    frames: (json.frames as unknown[])?.length ?? 198,
    incident: null,
  };
}

// ---------------------------------------------------------------------------
// Analysis pipeline step definitions
// ---------------------------------------------------------------------------

interface PipelineStep {
  text: string;
  color: string;
  indent?: number;
  delay: number;
}

interface FileInfo {
  filename: string;
  agents: number;
  frames: number;
  vehicles: number;
  pedestrians: number;
  cyclists: number;
  incident: string | null;
  egoSpeed: number;
  ttc: number | null;
  scenarioLabel: string;
}

function extractFileInfo(json: Record<string, unknown> | null, filename: string): FileInfo {
  if (!json) {
    return { filename, agents: 8, frames: 198, vehicles: 5, pedestrians: 2, cyclists: 1, incident: "Near-miss — vehicle lane encroachment", egoSpeed: 11.0, ttc: 1.2, scenarioLabel: "near_miss" };
  }
  const objs = (json.tracked_objects as { type?: string }[]) ?? [];
  const vehicles = objs.filter(o => o.type === "TYPE_VEHICLE").length;
  const pedestrians = objs.filter(o => o.type === "TYPE_PEDESTRIAN").length;
  const cyclists = objs.filter(o => o.type === "TYPE_CYCLIST").length;
  const framesArr = json.frames as { ego_speed?: number }[] | undefined;
  const stats = json.stats as Record<string, unknown> | undefined;
  const incidents = json.incidents as { description?: string; ttc?: number; ttc_seconds?: number }[] | undefined;
  const sid = (json.scenarioId as string) ?? "near_miss";
  const firstInc = incidents?.[0];
  return {
    filename: (json.segment_id as string) ?? filename,
    agents: objs.length,
    frames: framesArr?.length ?? (stats?.total_frames as number ?? 198),
    vehicles,
    pedestrians,
    cyclists,
    incident: firstInc?.description ?? null,
    egoSpeed: framesArr?.[0]?.ego_speed ?? 11.0,
    ttc: firstInc?.ttc ?? firstInc?.ttc_seconds ?? null,
    scenarioLabel: sid.replace(/_/g, " "),
  };
}

function buildPipelineSteps(
  info: FileInfo,
  scenarioText: string | null,
): PipelineStep[] {
  const steps: PipelineStep[] = [
    {
      text: `Loading driving log... ${info.filename}`,
      color: colors.accentBlue,
      delay: 300,
    },
    {
      text: `Parsing frame data... ${info.frames} frames @ 10 fps (${(info.frames / 10).toFixed(1)}s)`,
      color: colors.textSecondary,
      delay: 250,
    },
    {
      text: "Running LiDAR perception pipeline... 64-beam, 2650 cols, 75m range",
      color: colors.textSecondary,
      delay: 350,
    },
    {
      text: `Detecting tracked objects... ${info.agents} agents found`,
      color: colors.textSecondary,
      delay: 200,
    },
    {
      text: `  TYPE_VEHICLE     ${info.vehicles} detected`,
      color: "#FF9E00",
      indent: 1,
      delay: 200,
    },
    {
      text: `  TYPE_PEDESTRIAN  ${info.pedestrians} detected`,
      color: "#CCFF00",
      indent: 1,
      delay: 200,
    },
    {
      text: `  TYPE_CYCLIST     ${info.cyclists} detected`,
      color: "#DC143C",
      indent: 1,
      delay: 200,
    },
    {
      text: `Scenario classification: ${info.scenarioLabel}`,
      color: "#B490FF",
      delay: 250,
    },
    {
      text: `Analyzing ego trajectory... ${info.egoSpeed.toFixed(1)} m/s cruise, urban multilane`,
      color: colors.textSecondary,
      delay: 300,
    },
    ...(info.ttc != null ? [{
      text: `Computing collision metrics... TTC ${info.ttc.toFixed(1)}s`,
      color: colors.warning,
      delay: 350,
    }] : []),
    ...(info.incident ? [{
      text: `\u26A0 INCIDENT DETECTED: ${info.incident}`,
      color: colors.warning,
      delay: 400,
    }] : [{
      text: "\u2713 No critical incidents detected — nominal driving segment",
      color: colors.accent,
      delay: 400,
    }]),
    {
      text: "Generating adversarial scenario variations...",
      color: colors.textSecondary,
      delay: 300,
    },
    {
      text: "Computing counterfactual trajectories...",
      color: colors.textSecondary,
      delay: 250,
    },
    {
      text: "  \u251C\u2500\u2500 Ground Truth (continue path)",
      color: colors.accent,
      indent: 1,
      delay: 200,
    },
    {
      text: "  \u251C\u2500\u2500 Avoid Left (swerve left)",
      color: colors.accentBlue,
      indent: 1,
      delay: 200,
    },
    {
      text: "  \u251C\u2500\u2500 Avoid Right (swerve right)",
      color: colors.info,
      indent: 1,
      delay: 200,
    },
    {
      text: "  \u2514\u2500\u2500 Emergency Brake (hard stop)",
      color: colors.error,
      indent: 1,
      delay: 200,
    },
  ];

  if (scenarioText) {
    const mapped = classifyScenario(scenarioText);
    steps.push({
      text: `LLM scenario classification: ${mapped.replace(/_/g, " ")}`,
      color: "#B490FF",
      delay: 300,
    });
  }

  steps.push({
    text: "Analysis complete. 4 counterfactual variants generated.",
    color: colors.accent,
    delay: 400,
  });

  return steps;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function UploadPage() {
  const navigate = useNavigate();
  const actions = useStore((s) => s.actions);

  // Upload state
  const [dropHover, setDropHover] = useState(false);
  const [scenarioText, setScenarioText] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);

  // Analysis state
  const [analyzing, setAnalyzing] = useState(false);
  const [visibleSteps, setVisibleSteps] = useState<PipelineStep[]>([]);
  const [analysisComplete, setAnalysisComplete] = useState(false);
  const [progress, setProgress] = useState(0);
  const [resolvedScenarioId, setResolvedScenarioId] =
    useState<ScenarioId>("near_miss");

  // ------ Analysis pipeline animation ------

  const runAnalysis = useCallback(
    async (filename: string, textInput: string | null, parsedJson?: Record<string, unknown>) => {
      // Determine scenario from: 1) parsed JSON scenarioId field, 2) text input, 3) filename
      let sid: ScenarioId = "near_miss";
      if (parsedJson) {
        const info = classifyFromFileContent(parsedJson);
        sid = info.scenarioId;
      } else if (textInput) {
        sid = classifyScenario(textInput);
      } else {
        sid = classifyScenario(filename);
      }

      setResolvedScenarioId(sid);
      setAnalyzing(true);
      setAnalysisComplete(false);
      setVisibleSteps([]);
      setProgress(0);

      const fileInfo = extractFileInfo(parsedJson ?? null, filename);
      const steps = buildPipelineSteps(fileInfo, textInput);

      for (let i = 0; i < steps.length; i++) {
        await tick(steps[i].delay);
        setVisibleSteps((prev) => [...prev, steps[i]]);
        setProgress(((i + 1) / steps.length) * 100);
      }

      setAnalysisComplete(true);
    },
    [],
  );

  // ------ Continue to dashboard ------

  const handleContinue = useCallback(async () => {
    try {
      const sceneData = await loadScenario(resolvedScenarioId, "ground_truth");
      actions.setScenarioId(resolvedScenarioId);
      actions.setDataSource("scenario");
      actions.setSceneData(sceneData);
      actions.setTrajectoryMoments(generateTrajectoryMoments(sceneData));
      navigate("/dashboard");
    } catch (err) {
      console.error("[UploadPage] Failed to load scenario:", err);
      // Fallback: navigate anyway
      actions.setScenarioId(resolvedScenarioId);
      actions.setDataSource("scenario");
      navigate("/dashboard");
    }
  }, [actions, navigate, resolvedScenarioId]);

  // ------ Drop handlers ------

  const onDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    setDropHover(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current <= 0) {
      setDropHover(false);
      dragCounter.current = 0;
    }
  }, []);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDropHover(false);
      dragCounter.current = 0;

      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;

      const file = files[0];
      const fname = file.name;

      if (fname.endsWith(".json")) {
        const reader = new FileReader();
        reader.onload = () => {
          try {
            const parsed = JSON.parse(reader.result as string) as Record<string, unknown>;
            runAnalysis(fname, scenarioText || null, parsed);
          } catch {
            runAnalysis(fname, scenarioText || null);
          }
        };
        reader.readAsText(file);
      } else {
        runAnalysis(fname, scenarioText || null);
      }
    },
    [runAnalysis, scenarioText],
  );

  const onFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;
      runAnalysis(files[0].name, scenarioText || null);
    },
    [runAnalysis, scenarioText],
  );

  const handleDemoData = useCallback(() => {
    runAnalysis("waymo_scene_near_miss.json", scenarioText || null);
  }, [runAnalysis, scenarioText]);

  // ========================================================================
  // STATE 2 — Analysis Console
  // ========================================================================

  if (analyzing) {
    return (
      <div style={sx.analysisRoot}>
        <style>{keyframes}</style>

        {/* Progress bar at top */}
        <div style={sx.topProgressTrack}>
          <div
            style={{
              ...sx.topProgressFill,
              width: `${progress}%`,
            }}
          />
        </div>

        {/* Console container */}
        <div style={sx.consoleContainer}>
          {/* Console header */}
          <div style={sx.consoleHeader}>
            <div style={sx.consoleHeaderDots}>
              <span style={{ ...sx.consoleDot, background: "#EF4444" }} />
              <span style={{ ...sx.consoleDot, background: "#F5A623" }} />
              <span style={{ ...sx.consoleDot, background: "#00E89D" }} />
            </div>
            <span style={sx.consoleTitle}>
              overflow :: perception pipeline
            </span>
            <div style={{ width: 52 }} />
          </div>

          {/* Console body */}
          <div style={sx.consoleBody}>
            {visibleSteps.map((step, i) => (
              <div
                key={i}
                style={{
                  ...sx.consoleLine,
                  animation: "fadeInLine 0.3s ease-out",
                  paddingLeft: step.indent ? 24 : 0,
                }}
              >
                {/* Prefix icon */}
                {step.text.startsWith("\u26A0") ? (
                  <AlertTriangle
                    size={14}
                    color={colors.warning}
                    style={{ flexShrink: 0, marginRight: 8 }}
                  />
                ) : step.text.startsWith("Analysis complete") ? (
                  <CheckCircle
                    size={14}
                    color={colors.accent}
                    style={{ flexShrink: 0, marginRight: 8 }}
                  />
                ) : step.text.startsWith("LLM scenario") ? (
                  <Search
                    size={14}
                    color="#B490FF"
                    style={{ flexShrink: 0, marginRight: 8 }}
                  />
                ) : !step.indent ? (
                  <span style={sx.linePrefix}>&gt;</span>
                ) : null}

                <span
                  style={{
                    color: step.color,
                    fontFamily: fonts.mono,
                    fontSize: 13,
                    lineHeight: 1.7,
                    ...(step.text.startsWith("\u26A0")
                      ? {
                          fontWeight: 700,
                          textShadow: `0 0 20px rgba(245, 166, 35, 0.4)`,
                        }
                      : {}),
                    ...(step.text.startsWith("Analysis complete")
                      ? {
                          fontWeight: 600,
                          textShadow: `0 0 16px rgba(0, 232, 157, 0.3)`,
                        }
                      : {}),
                  }}
                >
                  {step.text}
                </span>
              </div>
            ))}

            {/* Blinking cursor */}
            {!analysisComplete && (
              <span style={sx.cursor}>_</span>
            )}
          </div>
        </div>

        {/* Continue button */}
        {analysisComplete && (
          <button
            style={sx.continueButton}
            onClick={handleContinue}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(0, 232, 157, 0.15)";
              e.currentTarget.style.borderColor = colors.accent;
              e.currentTarget.style.boxShadow = `0 0 30px rgba(0, 232, 157, 0.2)`;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(0, 232, 157, 0.08)";
              e.currentTarget.style.borderColor = "rgba(0, 232, 157, 0.3)";
              e.currentTarget.style.boxShadow = `0 0 20px rgba(0, 232, 157, 0.1)`;
            }}
          >
            <span>Continue to Dashboard</span>
            <ArrowRight size={18} strokeWidth={2} />
          </button>
        )}
      </div>
    );
  }

  // ========================================================================
  // STATE 1 — Upload
  // ========================================================================

  return (
    <div
      style={sx.root}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <style>{keyframes}</style>

      {/* Background grid */}
      <div style={sx.gridBg} />

      {/* Radial glow */}
      <div style={sx.radialGlow} />

      <div style={sx.content}>
        {/* Logo + tagline */}
        <div style={sx.header}>
          <div style={sx.logoRow}>
            <div style={sx.logoDot} />
            <h1 style={sx.logoText}>Overflow</h1>
          </div>
          <p style={sx.tagline}>
            Adversarial Scenario Generation for Autonomous Driving
          </p>
          <p style={sx.subtitle}>
            Upload driving data. Generate adversarial scenarios. Test your
            policy.
          </p>
        </div>

        {/* Drop zone */}
        <div
          style={{
            ...sx.dropZone,
            ...(dropHover ? sx.dropZoneHover : {}),
          }}
          onDragEnter={onDragEnter}
          onDragLeave={onDragLeave}
          onDragOver={onDragOver}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,.parquet,.bin,.bag,.mcap"
            style={{ display: "none" }}
            onChange={onFileSelect}
          />

          <div
            style={{
              ...sx.uploadIconCircle,
              ...(dropHover ? sx.uploadIconCircleHover : {}),
            }}
          >
            <Upload
              size={28}
              color={dropHover ? colors.accent : colors.textSecondary}
              strokeWidth={1.5}
            />
          </div>

          <span style={sx.dropTitle}>
            {dropHover ? "Release to analyze" : "Drag & drop driving data"}
          </span>
          <span style={sx.dropHint}>
            Supports Waymo Open Dataset format (.json, .parquet)
          </span>
        </div>

        {/* Text input */}
        <div style={sx.textInputContainer}>
          <Search
            size={16}
            color={colors.textDim}
            style={{ flexShrink: 0 }}
          />
          <span style={sx.textInputLabel}>Or describe a scenario:</span>
          <input
            type="text"
            value={scenarioText}
            onChange={(e) => setScenarioText(e.target.value)}
            placeholder="e.g., Pedestrian jaywalking at an intersection"
            style={sx.textInput}
            onKeyDown={(e) => {
              if (e.key === "Enter" && scenarioText.trim()) {
                runAnalysis("scenario_from_description.json", scenarioText);
              }
            }}
          />
        </div>

        {/* Action buttons */}
        <div style={sx.actionsRow}>
          <button
            style={sx.demoButton}
            onClick={handleDemoData}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(0, 232, 157, 0.14)";
              e.currentTarget.style.borderColor = colors.accent;
              e.currentTarget.style.boxShadow = `0 0 28px rgba(0, 232, 157, 0.15)`;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(0, 232, 157, 0.06)";
              e.currentTarget.style.borderColor = "rgba(0, 232, 157, 0.2)";
              e.currentTarget.style.boxShadow = "none";
            }}
          >
            <Database size={16} strokeWidth={1.5} />
            Try Demo Data
            <ArrowRight size={14} strokeWidth={2} style={{ opacity: 0.6 }} />
          </button>

          <DownloadMenu />
        </div>

        {/* Format note */}
        <span style={sx.formatNote}>
          Supports Waymo Open Dataset format (.json, .parquet)
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Download menu — all scenario data files
// ---------------------------------------------------------------------------

const DEMO_FILES = [
  { file: "waymo_scene_near_miss.json", label: "Near Miss" },
  { file: "waymo_scene_rear_end.json", label: "Rear End Collision" },
  { file: "waymo_scene_jaywalker.json", label: "Jaywalker" },
  { file: "waymo_scene_red_light.json", label: "Red Light Runner" },
  { file: "waymo_scene_swerving.json", label: "Swerving Vehicle" },
  { file: "waymo_scene_normal.json", label: "Normal Traffic" },
  { file: "waymo_scene_final_model.json", label: "Complex Multi-Hazard" },
];

function DownloadMenu() {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "10px 18px",
          borderRadius: 8,
          background: "rgba(255,255,255,0.03)",
          border: `1px solid ${open ? "rgba(0,232,157,0.2)" : colors.border}`,
          color: open ? colors.accent : colors.textSecondary,
          fontFamily: fonts.sans,
          fontSize: 13,
          cursor: "pointer",
          transition: "all 0.2s",
        }}
      >
        <Upload size={14} strokeWidth={1.5} style={{ transform: "rotate(180deg)" }} />
        Download Scenarios
      </button>
      {open && (
        <div style={{
          position: "absolute",
          top: "calc(100% + 4px)",
          right: 0,
          background: "rgba(14,17,28,0.95)",
          backdropFilter: "blur(20px)",
          border: `1px solid ${colors.border}`,
          borderRadius: 8,
          padding: 4,
          minWidth: 220,
          zIndex: 100,
          boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
        }}>
          {DEMO_FILES.map(({ file, label }) => (
            <a
              key={file}
              href={`/demo_data/${file}`}
              download={file}
              onClick={() => setOpen(false)}
              style={{
                display: "block",
                padding: "7px 12px",
                borderRadius: 6,
                fontSize: 12,
                color: colors.textSecondary,
                textDecoration: "none",
                fontFamily: fonts.sans,
                transition: "background 0.1s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(0,232,157,0.06)";
                e.currentTarget.style.color = colors.accent;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.color = colors.textSecondary;
              }}
            >
              {label}
              <span style={{ fontFamily: fonts.mono, fontSize: 9, color: colors.textDim, marginLeft: 8 }}>
                .json
              </span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tick(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Keyframes
// ---------------------------------------------------------------------------

const keyframes = `
@keyframes gridPulse {
  0%, 100% { opacity: 0.03; }
  50%      { opacity: 0.06; }
}
@keyframes fadeInUp {
  from { opacity: 0; transform: translateY(20px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes fadeInLine {
  from { opacity: 0; transform: translateX(-8px); }
  to   { opacity: 1; transform: translateX(0); }
}
@keyframes blink {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0; }
}
@keyframes pulseGlow {
  0%, 100% { box-shadow: 0 0 20px rgba(0, 232, 157, 0.08); }
  50%      { box-shadow: 0 0 40px rgba(0, 232, 157, 0.18); }
}
@keyframes continueFadeIn {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
}
`;

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const sx: Record<string, React.CSSProperties> = {
  // ===== STATE 1 — Upload =====

  root: {
    position: "fixed",
    inset: 0,
    backgroundColor: colors.bgDeep,
    fontFamily: fonts.sans,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "auto",
  },

  gridBg: {
    position: "absolute",
    inset: 0,
    backgroundImage: `
      linear-gradient(rgba(0,232,157,0.03) 1px, transparent 1px),
      linear-gradient(90deg, rgba(0,232,157,0.03) 1px, transparent 1px)
    `,
    backgroundSize: "60px 60px",
    animation: "gridPulse 6s ease-in-out infinite",
    pointerEvents: "none",
  },

  radialGlow: {
    position: "absolute",
    top: "30%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    width: 800,
    height: 600,
    background:
      "radial-gradient(ellipse at center, rgba(0,232,157,0.04) 0%, transparent 60%)",
    pointerEvents: "none",
  },

  content: {
    position: "relative",
    zIndex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 24,
    padding: "40px 24px",
    maxWidth: 640,
    width: "100%",
    animation: "fadeInUp 0.6s ease-out",
  },

  header: {
    textAlign: "center",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 12,
    marginBottom: 8,
  },

  logoRow: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    marginBottom: 4,
  },

  logoDot: {
    width: 16,
    height: 16,
    borderRadius: "50%",
    background: `linear-gradient(135deg, ${colors.accent}, ${colors.accentBlue})`,
    boxShadow: `0 0 20px ${colors.accentDim}`,
    animation: "pulseGlow 3s ease-in-out infinite",
  },

  logoText: {
    fontSize: 36,
    fontWeight: 700,
    letterSpacing: "-0.03em",
    color: colors.textPrimary,
    margin: 0,
    background: `linear-gradient(135deg, ${colors.textPrimary} 40%, ${colors.accent})`,
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
  },

  tagline: {
    fontSize: 15,
    fontWeight: 500,
    color: colors.textSecondary,
    margin: 0,
    lineHeight: 1.5,
    letterSpacing: "-0.01em",
  },

  subtitle: {
    fontSize: 13,
    fontWeight: 400,
    color: colors.textDim,
    margin: 0,
    lineHeight: 1.6,
  },

  // Drop zone
  dropZone: {
    width: "100%",
    maxWidth: 520,
    padding: "52px 32px",
    borderRadius: 16,
    border: `2px dashed ${colors.border}`,
    backgroundColor: "rgba(22, 26, 42, 0.5)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 14,
    cursor: "pointer",
    transition: "all 0.3s ease",
    position: "relative",
  },

  dropZoneHover: {
    borderColor: colors.accent,
    backgroundColor: "rgba(0, 232, 157, 0.04)",
    boxShadow: `0 0 60px rgba(0, 232, 157, 0.12), inset 0 0 60px rgba(0, 232, 157, 0.03)`,
  },

  uploadIconCircle: {
    width: 60,
    height: 60,
    borderRadius: "50%",
    backgroundColor: "rgba(255, 255, 255, 0.03)",
    border: `1px solid ${colors.border}`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "all 0.3s ease",
    marginBottom: 4,
  },

  uploadIconCircleHover: {
    backgroundColor: "rgba(0, 232, 157, 0.1)",
    borderColor: colors.accentDim,
    boxShadow: `0 0 30px rgba(0, 232, 157, 0.2)`,
  },

  dropTitle: {
    fontSize: 16,
    fontWeight: 500,
    color: colors.textPrimary,
  },

  dropHint: {
    fontSize: 12,
    color: colors.textDim,
    fontFamily: fonts.mono,
  },

  // Text input
  textInputContainer: {
    width: "100%",
    maxWidth: 520,
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "12px 16px",
    borderRadius: 10,
    border: `1px solid ${colors.border}`,
    backgroundColor: "rgba(22, 26, 42, 0.6)",
    transition: "all 0.25s ease",
  },

  textInputLabel: {
    fontSize: 13,
    fontWeight: 500,
    color: colors.textDim,
    whiteSpace: "nowrap",
    flexShrink: 0,
  },

  textInput: {
    flex: 1,
    background: "none",
    border: "none",
    outline: "none",
    color: colors.textPrimary,
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 1.5,
    padding: 0,
  },

  // Action buttons
  actionsRow: {
    display: "flex",
    gap: 12,
    alignItems: "center",
    flexWrap: "wrap" as const,
    justifyContent: "center",
  },

  demoButton: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "12px 26px",
    borderRadius: 10,
    border: `1px solid rgba(0, 232, 157, 0.2)`,
    backgroundColor: "rgba(0, 232, 157, 0.06)",
    color: colors.accent,
    fontSize: 14,
    fontWeight: 500,
    fontFamily: fonts.sans,
    cursor: "pointer",
    transition: "all 0.25s ease",
  },

  downloadLink: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "10px 18px",
    borderRadius: 8,
    background: "rgba(255,255,255,0.03)",
    border: `1px solid ${colors.border}`,
    color: colors.textSecondary,
    fontFamily: fonts.sans,
    fontSize: 13,
    textDecoration: "none",
    cursor: "pointer",
    transition: "all 0.2s",
  },

  formatNote: {
    fontSize: 11,
    color: colors.textMuted,
    fontFamily: fonts.mono,
    letterSpacing: "0.02em",
  },

  // ===== STATE 2 — Analysis =====

  analysisRoot: {
    position: "fixed",
    inset: 0,
    backgroundColor: "#0C0E18",
    fontFamily: fonts.mono,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 32,
    padding: 24,
    overflow: "auto",
  },

  topProgressTrack: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: "rgba(255,255,255,0.04)",
    zIndex: 10,
  },

  topProgressFill: {
    height: "100%",
    background: `linear-gradient(90deg, ${colors.accent}, ${colors.accentBlue})`,
    transition: "width 0.4s ease-out",
    boxShadow: `0 0 12px rgba(0, 232, 157, 0.4)`,
  },

  consoleContainer: {
    width: "100%",
    maxWidth: 720,
    borderRadius: 12,
    border: `1px solid rgba(255,255,255,0.06)`,
    backgroundColor: "rgba(12, 14, 24, 0.95)",
    overflow: "hidden",
    boxShadow: `0 0 60px rgba(0, 0, 0, 0.5), 0 0 30px rgba(0, 232, 157, 0.03)`,
  },

  consoleHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 16px",
    backgroundColor: "rgba(255,255,255,0.02)",
    borderBottom: "1px solid rgba(255,255,255,0.04)",
  },

  consoleHeaderDots: {
    display: "flex",
    gap: 7,
  },

  consoleDot: {
    display: "inline-block",
    width: 10,
    height: 10,
    borderRadius: "50%",
  },

  consoleTitle: {
    fontSize: 11,
    fontWeight: 500,
    color: colors.textDim,
    fontFamily: fonts.mono,
    letterSpacing: "0.04em",
    textTransform: "uppercase" as const,
  },

  consoleBody: {
    padding: "20px 24px",
    minHeight: 320,
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },

  consoleLine: {
    display: "flex",
    alignItems: "center",
    minHeight: 24,
  },

  linePrefix: {
    color: colors.accent,
    fontFamily: fonts.mono,
    fontSize: 13,
    marginRight: 10,
    opacity: 0.5,
    flexShrink: 0,
  },

  cursor: {
    display: "inline-block",
    color: colors.accent,
    fontFamily: fonts.mono,
    fontSize: 14,
    fontWeight: 700,
    animation: "blink 0.8s step-end infinite",
    marginLeft: 2,
    marginTop: 4,
  },

  continueButton: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "14px 32px",
    borderRadius: 10,
    border: `1px solid rgba(0, 232, 157, 0.3)`,
    background: "rgba(0, 232, 157, 0.08)",
    color: colors.accent,
    fontSize: 15,
    fontWeight: 600,
    fontFamily: fonts.sans,
    cursor: "pointer",
    transition: "all 0.25s ease",
    animation: "continueFadeIn 0.5s ease-out",
    boxShadow: `0 0 20px rgba(0, 232, 157, 0.1)`,
  },
};
