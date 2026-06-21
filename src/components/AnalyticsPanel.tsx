/**
 * AnalyticsPanel — Full-screen overlay tab with:
 *   • Benchmarks (performance metrics)
 *   • Incident Tickets log
 *   • Graphs & Statistics
 *   • Agent Hierarchy
 *   • Activity Log
 */

import { useState, useEffect, useRef, useCallback, useSyncExternalStore } from "react";
import { useStore } from "../store";
import { colors, fonts } from "../theme";
import { SCENARIO_INFO } from "../mockData";
import type { ScenarioId } from "../mockData";
import {
  getTicketLog,
  clearTicketLog,
  subscribeTicketLog,
  type TicketRecord,
} from "./ToastNotifications";

// ---------------------------------------------------------------------------
// Hook to subscribe to ticket log changes
// ---------------------------------------------------------------------------

function useTicketLog(): TicketRecord[] {
  return useSyncExternalStore(
    subscribeTicketLog,
    getTicketLog,
    getTicketLog,
  );
}

// ---------------------------------------------------------------------------
// Tab type
// ---------------------------------------------------------------------------

type Tab = "benchmarks" | "tickets" | "stats" | "agents" | "logs";

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: "benchmarks", label: "Benchmarks", icon: "⚡" },
  { key: "tickets", label: "Tickets", icon: "🎫" },
  { key: "stats", label: "Statistics", icon: "📊" },
  { key: "agents", label: "Agents", icon: "🧠" },
  { key: "logs", label: "Logs", icon: "📋" },
];

// ---------------------------------------------------------------------------
// Severity colors
// ---------------------------------------------------------------------------

const SEV_COLORS: Record<string, string> = {
  info: colors.accentBlue,
  warning: "#FFB020",
  critical: "#FF4444",
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function AnalyticsPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("benchmarks");

  if (!open) return null;

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 200,
      background: "rgba(8,10,18,0.96)",
      backdropFilter: "blur(30px)",
      display: "flex", flexDirection: "column",
      fontFamily: fonts.sans,
      color: colors.textPrimary,
    }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "16px 24px",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 20 }}>📈</span>
          <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: "0.5px" }}>
            Analytics
          </span>
          <span style={{
            fontSize: 10, color: colors.textDim, fontFamily: fonts.mono,
            background: "rgba(255,255,255,0.04)", padding: "3px 10px", borderRadius: 4,
          }}>
            Overflow Dashboard
          </span>
        </div>
        <button onClick={onClose} style={{
          background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 6, padding: "6px 14px", cursor: "pointer",
          fontSize: 12, fontWeight: 600, color: colors.textSecondary,
          fontFamily: fonts.sans, transition: "all 0.15s",
        }}>
          ✕ Close
        </button>
      </div>

      {/* Tab bar */}
      <div style={{
        display: "flex", gap: 2, padding: "8px 24px",
        borderBottom: "1px solid rgba(255,255,255,0.04)",
        flexShrink: 0,
      }}>
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "8px 16px", borderRadius: 6, cursor: "pointer",
            border: "none",
            background: tab === t.key ? "rgba(0,232,157,0.1)" : "rgba(255,255,255,0.02)",
            color: tab === t.key ? colors.accent : colors.textDim,
            fontSize: 12, fontWeight: tab === t.key ? 600 : 400,
            fontFamily: fonts.sans, transition: "all 0.15s",
          }}>
            <span>{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflow: "auto", padding: "20px 24px" }}>
        {tab === "benchmarks" && <BenchmarksTab />}
        {tab === "tickets" && <TicketsTab />}
        {tab === "stats" && <StatsTab />}
        {tab === "agents" && <AgentsTab />}
        {tab === "logs" && <LogsTab />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// BENCHMARKS TAB
// ---------------------------------------------------------------------------

function BenchmarksTab() {
  const sceneData = useStore((s) => s.sceneData);
  const dataSource = useStore((s) => s.dataSource);
  const [fps, setFps] = useState(0);
  const frameTimesRef = useRef<number[]>([]);
  const lastFrameRef = useRef(performance.now());

  useEffect(() => {
    const interval = setInterval(() => {
      const now = performance.now();
      frameTimesRef.current.push(now - lastFrameRef.current);
      lastFrameRef.current = now;
      if (frameTimesRef.current.length > 60) frameTimesRef.current.shift();
      const avg = frameTimesRef.current.reduce((a, b) => a + b, 0) / frameTimesRef.current.length;
      setFps(Math.round(1000 / avg));
    }, 100);
    return () => clearInterval(interval);
  }, []);

  const totalFrames = sceneData?.totalFrames ?? 0;
  const avgPts = sceneData
    ? Math.round(sceneData.frames.reduce((a, f) => a + f.pointCount, 0) / sceneData.frames.length)
    : 0;
  const avgBoxes = sceneData
    ? Math.round(sceneData.frames.reduce((a, f) => a + f.boxes.length, 0) / sceneData.frames.length)
    : 0;
  const totalPts = sceneData
    ? sceneData.frames.reduce((a, f) => a + f.pointCount, 0)
    : 0;

  const metrics = [
    { label: "Data Source", value: dataSource.toUpperCase(), color: colors.accent },
    { label: "Total Frames", value: String(totalFrames), color: colors.accentBlue },
    { label: "Render FPS", value: `${fps}`, color: fps > 30 ? colors.accent : "#FF4444" },
    { label: "Avg Points/Frame", value: avgPts.toLocaleString(), color: colors.textPrimary },
    { label: "Avg Boxes/Frame", value: String(avgBoxes), color: colors.textPrimary },
    { label: "Total Points", value: totalPts.toLocaleString(), color: colors.textPrimary },
    { label: "Duration", value: `${((sceneData?.totalSeconds ?? 0)).toFixed(1)}s`, color: colors.textPrimary },
    { label: "Playback Rate", value: `${sceneData?.fps ?? 10} Hz`, color: colors.textPrimary },
  ];

  return (
    <div>
      <SectionTitle>Performance Metrics</SectionTitle>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 24 }}>
        {metrics.map((m) => (
          <MetricCard key={m.label} label={m.label} value={m.value} color={m.color} />
        ))}
      </div>

      <SectionTitle>Per-Frame Point Cloud Density</SectionTitle>
      <MiniBarChart
        data={sceneData?.frames.map((f) => f.pointCount) ?? []}
        color={colors.accent}
        height={80}
      />

      <SectionTitle>Per-Frame Object Count</SectionTitle>
      <MiniBarChart
        data={sceneData?.frames.map((f) => f.boxes.length) ?? []}
        color={colors.accentBlue}
        height={80}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// TICKETS TAB
// ---------------------------------------------------------------------------

function TicketsTab() {
  const ticketLog = useTicketLog();
  const actions = useStore((s) => s.actions);
  const [filter, setFilter] = useState<"all" | "critical" | "warning" | "info">("all");

  const filtered = filter === "all" ? ticketLog : ticketLog.filter((t) => t.severity === filter);
  const critCount = ticketLog.filter((t) => t.severity === "critical").length;
  const warnCount = ticketLog.filter((t) => t.severity === "warning").length;
  const infoCount = ticketLog.filter((t) => t.severity === "info").length;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <SectionTitle>Incident Tickets ({ticketLog.length})</SectionTitle>
        <div style={{ display: "flex", gap: 6 }}>
          {(["all", "critical", "warning", "info"] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)} style={{
              padding: "4px 12px", fontSize: 10, fontFamily: fonts.mono, fontWeight: filter === f ? 600 : 400,
              color: filter === f ? (f === "critical" ? "#FF4444" : f === "warning" ? "#FFB020" : f === "info" ? colors.accentBlue : colors.accent) : colors.textDim,
              background: filter === f ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.02)",
              border: "1px solid rgba(255,255,255,0.06)", borderRadius: 4, cursor: "pointer",
              textTransform: "uppercase",
            }}>
              {f} {f === "critical" ? `(${critCount})` : f === "warning" ? `(${warnCount})` : f === "info" ? `(${infoCount})` : ""}
            </button>
          ))}
          <button onClick={() => clearTicketLog()} style={{
            padding: "4px 12px", fontSize: 10, fontFamily: fonts.mono,
            color: colors.textDim, background: "rgba(255,68,68,0.08)",
            border: "1px solid rgba(255,68,68,0.15)", borderRadius: 4, cursor: "pointer",
          }}>
            Clear All
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: 40, color: colors.textDim, fontSize: 12, fontFamily: fonts.mono }}>
          No tickets yet. Play a scenario to detect incidents.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {filtered.map((ticket) => (
            <div key={ticket.id} style={{
              display: "flex", alignItems: "flex-start", gap: 12,
              padding: "10px 14px",
              background: "rgba(255,255,255,0.02)",
              border: `1px solid ${SEV_COLORS[ticket.severity]}20`,
              borderLeft: `3px solid ${SEV_COLORS[ticket.severity]}`,
              borderRadius: 6,
              cursor: "pointer",
              transition: "background 0.1s",
            }}
            onClick={() => { actions.setFrame(ticket.frame); actions.setPlaying(false); }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.02)"; }}
            >
              <div style={{
                fontSize: 7, fontWeight: 700, color: SEV_COLORS[ticket.severity],
                background: `${SEV_COLORS[ticket.severity]}15`,
                padding: "3px 8px", borderRadius: 3, fontFamily: fonts.mono,
                textTransform: "uppercase", letterSpacing: "0.8px", flexShrink: 0,
                marginTop: 2,
              }}>
                {ticket.severity}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: colors.textPrimary, marginBottom: 2 }}>
                  {ticket.title}
                </div>
                <div style={{ fontSize: 10, color: colors.textSecondary, fontFamily: fonts.mono, lineHeight: 1.5 }}>
                  {ticket.what}
                </div>
                <div style={{ fontSize: 9, color: colors.textDim, fontFamily: fonts.mono, marginTop: 4, display: "flex", gap: 12 }}>
                  <span>⏱ {ticket.time.toFixed(2)}s</span>
                  <span>🎞 Frame {ticket.frame}</span>
                  <span>📍 {ticket.where}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// STATS TAB
// ---------------------------------------------------------------------------

function StatsTab() {
  const sceneData = useStore((s) => s.sceneData);
  const ticketLog = useTicketLog();

  if (!sceneData) return <Empty text="Load a dataset to see statistics." />;

  // Object type distribution
  const typeCounts: Record<string, number> = {};
  for (const frame of sceneData.frames) {
    for (const box of frame.boxes) {
      typeCounts[box.type] = (typeCounts[box.type] ?? 0) + 1;
    }
  }

  // Speed distribution
  const speeds: number[] = [];
  for (const frame of sceneData.frames) {
    for (const box of frame.boxes) {
      if (box.speed > 0.1) speeds.push(box.speed * 3.6);
    }
  }
  const avgSpeed = speeds.length > 0 ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 0;
  const maxSpeed = speeds.length > 0 ? Math.max(...speeds) : 0;

  // Closest approach per frame
  const minDists = sceneData.frames.map((f) => {
    let min = Infinity;
    for (const box of f.boxes) {
      if (box.id.startsWith("_")) continue;
      const d = Math.sqrt(box.cx ** 2 + box.cy ** 2);
      if (d < min) min = d;
    }
    return min === Infinity ? 50 : min;
  });

  // Incident timeline
  const critPerSecond: number[] = [];
  const fps = sceneData.fps;
  const duration = sceneData.totalSeconds;
  for (let s = 0; s < duration; s++) {
    const startF = Math.floor(s * fps);
    const endF = Math.min(Math.floor((s + 1) * fps), sceneData.totalFrames);
    let count = 0;
    for (const t of ticketLog) {
      if (t.frame >= startF && t.frame < endF) count++;
    }
    critPerSecond.push(count);
  }

  return (
    <div>
      <SectionTitle>Object Type Distribution</SectionTitle>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 24 }}>
        {Object.entries(typeCounts).map(([type, count]) => (
          <MetricCard
            key={type}
            label={type.charAt(0).toUpperCase() + type.slice(1) + " detections"}
            value={count.toLocaleString()}
            color={type === "vehicle" ? colors.boxVehicle : type === "pedestrian" ? colors.boxPedestrian : type === "cyclist" ? colors.boxCyclist : colors.boxSign}
          />
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 24 }}>
        <MetricCard label="Avg Speed (moving objects)" value={`${avgSpeed.toFixed(1)} km/h`} color={colors.accentBlue} />
        <MetricCard label="Max Speed" value={`${maxSpeed.toFixed(1)} km/h`} color="#FF9E00" />
        <MetricCard label="Incidents Detected" value={String(ticketLog.length)} color="#FF4444" />
      </div>

      <SectionTitle>Closest Object Distance (per frame)</SectionTitle>
      <MiniBarChart data={minDists} color="#FF9E00" height={80} maxVal={50} invertColor />

      <SectionTitle>Incidents per Second</SectionTitle>
      <MiniBarChart data={critPerSecond} color="#FF4444" height={60} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// AGENTS TAB
// ---------------------------------------------------------------------------

function AgentsTab() {
  return (
    <div>
      <SectionTitle>Agent Hierarchy — Overflow Processing Pipeline</SectionTitle>
      <div style={{
        display: "flex", flexDirection: "column", gap: 0,
        background: "rgba(255,255,255,0.02)", borderRadius: 10,
        border: "1px solid rgba(255,255,255,0.04)",
        padding: 20, marginBottom: 24,
      }}>
        <AgentNode
          level={0}
          name="Overflow Orchestrator"
          role="Root coordinator — manages data flow between all subsystems"
          status="active"
          icon="🧠"
        />

        <AgentConnector />

        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <AgentNode
              level={1}
              name="Perception Engine"
              role="Point cloud processing, object detection, 3D bounding boxes"
              status="active"
              icon="👁"
            />
            <AgentConnector small />
            <AgentNode
              level={2}
              name="LiDAR Processor"
              role="64-beam sweep, range/intensity/elongation extraction"
              status="active"
              icon="📡"
            />
            <AgentConnector small />
            <AgentNode
              level={2}
              name="Object Classifier"
              role="Vehicle / pedestrian / cyclist / sign classification"
              status="active"
              icon="🏷"
            />
          </div>

          <div style={{ flex: 1 }}>
            <AgentNode
              level={1}
              name="Prediction Engine"
              role="Trajectory forecasting, behavior prediction, TTC estimation"
              status="active"
              icon="🔮"
            />
            <AgentConnector small />
            <AgentNode
              level={2}
              name="Trajectory Planner"
              role="Candidate future paths with preference scores"
              status="active"
              icon="🛤"
            />
            <AgentConnector small />
            <AgentNode
              level={2}
              name="Observer Model"
              role="Evaluates planner choices, selects optimal trajectory"
              status="active"
              icon="🔍"
            />
          </div>

          <div style={{ flex: 1 }}>
            <AgentNode
              level={1}
              name="Risk Assessment"
              role="Incident detection, proximity alerts, safety scoring"
              status="active"
              icon="⚠️"
            />
            <AgentConnector small />
            <AgentNode
              level={2}
              name="Collision Detector"
              role="TTC < 3s alerts, proximity monitoring"
              status="active"
              icon="💥"
            />
            <AgentConnector small />
            <AgentNode
              level={2}
              name="Ticket Generator"
              role="Auto-creates incident reports with context"
              status="active"
              icon="🎫"
            />
          </div>
        </div>

        <AgentConnector />

        <AgentNode
          level={1}
          name="Scenario AI (GPT-4o-mini)"
          role="Natural language → simulation parameters via LLM"
          status="idle"
          icon="🤖"
        />
      </div>

      <SectionTitle>Processing Pipeline Data Flow</SectionTitle>
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "12px 16px",
        background: "rgba(255,255,255,0.02)",
        borderRadius: 8,
        fontFamily: fonts.mono, fontSize: 10, color: colors.textDim,
        overflowX: "auto",
      }}>
        <FlowStep label="Raw Data" sub="Parquet / Scenario" />
        <FlowArrow />
        <FlowStep label="Parse & Decode" sub="Hyparquet" />
        <FlowArrow />
        <FlowStep label="Frame Assembly" sub="Per-frame grouping" />
        <FlowArrow />
        <FlowStep label="Perception" sub="Box + Cloud" />
        <FlowArrow />
        <FlowStep label="Prediction" sub="Trajectories" />
        <FlowArrow />
        <FlowStep label="Risk Eval" sub="TTC / Proximity" />
        <FlowArrow />
        <FlowStep label="Render" sub="Three.js / R3F" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// LOGS TAB
// ---------------------------------------------------------------------------

function LogsTab() {
  const [logs, setLogs] = useState<{ time: string; level: string; msg: string }[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Intercept console.log
  useEffect(() => {
    const orig = console.log;
    const origWarn = console.warn;
    const origError = console.error;

    const push = (level: string, args: unknown[]) => {
      const msg = args.map((a) => typeof a === "string" ? a : JSON.stringify(a)).join(" ");
      const time = new Date().toLocaleTimeString("en-US", { hour12: false, fractionalSecondDigits: 3 });
      setLogs((prev) => [...prev.slice(-500), { time, level, msg }]);
    };

    console.log = (...args: unknown[]) => { orig.apply(console, args); push("info", args); };
    console.warn = (...args: unknown[]) => { origWarn.apply(console, args); push("warn", args); };
    console.error = (...args: unknown[]) => { origError.apply(console, args); push("error", args); };

    return () => {
      console.log = orig;
      console.warn = origWarn;
      console.error = origError;
    };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [logs.length]);

  const levelColor = (level: string) => level === "error" ? "#FF4444" : level === "warn" ? "#FFB020" : colors.textDim;

  return (
    <div>
      <SectionTitle>Application Logs</SectionTitle>
      <div
        ref={scrollRef}
        style={{
          background: "rgba(0,0,0,0.3)", borderRadius: 8,
          border: "1px solid rgba(255,255,255,0.04)",
          padding: 12, maxHeight: 500, overflowY: "auto",
          fontFamily: fonts.mono, fontSize: 10, lineHeight: 1.6,
        }}
      >
        {logs.length === 0 && (
          <span style={{ color: colors.textDim }}>Capturing logs… interact with the app to see output.</span>
        )}
        {logs.map((log, i) => (
          <div key={i} style={{ display: "flex", gap: 8, color: colors.textSecondary }}>
            <span style={{ color: colors.textDim, flexShrink: 0 }}>{log.time}</span>
            <span style={{ color: levelColor(log.level), fontWeight: 700, flexShrink: 0, minWidth: 36, textTransform: "uppercase" }}>
              {log.level}
            </span>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {log.msg}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared sub-components
// ---------------------------------------------------------------------------

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 style={{
      fontSize: 12, fontWeight: 700, color: colors.textPrimary,
      letterSpacing: "0.5px", margin: "0 0 12px",
      display: "flex", alignItems: "center", gap: 8,
    }}>
      {children}
    </h3>
  );
}

function MetricCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{
      padding: "14px 16px",
      background: "rgba(255,255,255,0.02)",
      border: "1px solid rgba(255,255,255,0.04)",
      borderRadius: 8,
    }}>
      <div style={{ fontSize: 22, fontWeight: 700, color, fontFamily: fonts.mono, marginBottom: 4 }}>
        {value}
      </div>
      <div style={{ fontSize: 9, color: colors.textDim, fontFamily: fonts.mono, textTransform: "uppercase", letterSpacing: "0.8px" }}>
        {label}
      </div>
    </div>
  );
}

function MiniBarChart({
  data, color, height, maxVal, invertColor,
}: {
  data: number[]; color: string; height: number; maxVal?: number; invertColor?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || data.length === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const max = maxVal ?? Math.max(...data, 1);
    const barW = Math.max(1, w / data.length);

    for (let i = 0; i < data.length; i++) {
      const val = data[i];
      const ratio = Math.min(1, val / max);
      const barH = ratio * (h - 4);

      if (invertColor) {
        // Low values = green, high values = red
        const r = Math.round(255 * ratio);
        const g = Math.round(255 * (1 - ratio));
        ctx.fillStyle = `rgba(${r}, ${g}, 0, 0.7)`;
      } else {
        ctx.fillStyle = color + "B0";
      }

      ctx.fillRect(i * barW, h - barH - 2, barW - 1, barH);
    }
  }, [data, color, height, maxVal, invertColor]);

  return (
    <canvas
      ref={canvasRef}
      width={800}
      height={height}
      style={{
        width: "100%", height, borderRadius: 6,
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.04)",
        marginBottom: 20,
      }}
    />
  );
}

function AgentNode({
  level, name, role, status, icon,
}: {
  level: number; name: string; role: string; status: "active" | "idle" | "error"; icon: string;
}) {
  const statusColor = status === "active" ? colors.accent : status === "error" ? "#FF4444" : colors.textDim;
  return (
    <div style={{
      marginLeft: level * 20,
      padding: "8px 14px",
      background: "rgba(255,255,255,0.02)",
      border: `1px solid ${statusColor}30`,
      borderRadius: 8,
      display: "flex", alignItems: "center", gap: 10,
    }}>
      <span style={{ fontSize: 16 }}>{icon}</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: colors.textPrimary }}>
          {name}
        </div>
        <div style={{ fontSize: 9, color: colors.textDim, fontFamily: fonts.mono }}>
          {role}
        </div>
      </div>
      <span style={{
        width: 8, height: 8, borderRadius: "50%",
        background: statusColor,
        boxShadow: status === "active" ? `0 0 8px ${statusColor}` : "none",
      }} />
    </div>
  );
}

function AgentConnector({ small }: { small?: boolean }) {
  return (
    <div style={{
      marginLeft: small ? 30 : 24,
      width: 1,
      height: small ? 8 : 12,
      background: "rgba(255,255,255,0.1)",
    }} />
  );
}

function FlowStep({ label, sub }: { label: string; sub: string }) {
  return (
    <div style={{
      padding: "6px 12px",
      background: "rgba(0,232,157,0.06)",
      border: `1px solid ${colors.accent}20`,
      borderRadius: 6, textAlign: "center", flexShrink: 0,
    }}>
      <div style={{ fontSize: 10, fontWeight: 600, color: colors.textPrimary }}>{label}</div>
      <div style={{ fontSize: 8, color: colors.textDim }}>{sub}</div>
    </div>
  );
}

function FlowArrow() {
  return <span style={{ fontSize: 14, color: colors.accent }}>→</span>;
}

function Empty({ text }: { text: string }) {
  return (
    <div style={{ textAlign: "center", padding: 40, color: colors.textDim, fontSize: 12, fontFamily: fonts.mono }}>
      {text}
    </div>
  );
}
