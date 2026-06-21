/**
 * TicketConsole — Floating bottom-right panel showing a live incident ticket
 * log with full incident reports: what happened, where, when, involved objects.
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { useStore } from "../store";
import { colors, fonts } from "../theme";
import { SCENARIO_INFO } from "../mockData";
import type { BBox3D } from "../mockData";

// ---------------------------------------------------------------------------
// Ticket types
// ---------------------------------------------------------------------------

interface Ticket {
  id: number;
  time: number;        // seconds into recording
  frame: number;
  severity: "info" | "warning" | "critical";
  title: string;

  // Rich detail
  what: string;        // description of what happened
  where: string;       // ego-relative location
  involvedObjects: { label: string; type: string; dist: number; speed: number }[];
  egoPosition: [number, number, number] | null;
  egoSpeed: number | null;
  objectId?: string;
}

const SEV_COLORS: Record<string, string> = {
  info: colors.accentBlue,
  warning: "#FFB020",
  critical: "#FF4444",
};
const SEV_BADGE: Record<string, string> = {
  info: "INFO",
  warning: "WARN",
  critical: "CRIT",
};

let _ticketId = 0;

function bearingLabel(cx: number, cy: number): string {
  const angle = Math.atan2(cy, cx) * (180 / Math.PI);
  if (angle > -22 && angle <= 22) return "ahead";
  if (angle > 22 && angle <= 67) return "front-left";
  if (angle > 67 && angle <= 112) return "left";
  if (angle > 112 || angle <= -157) return "behind";
  if (angle > -157 && angle <= -112) return "behind-right";
  if (angle > -112 && angle <= -67) return "right";
  if (angle > -67 && angle <= -22) return "front-right";
  return "nearby";
}

function detectIncidents(
  boxes: BBox3D[],
  frameIdx: number,
  fps: number,
  egoPos: [number, number, number] | undefined,
): Ticket[] {
  const t = frameIdx / fps;
  const tickets: Ticket[] = [];

  for (const box of boxes) {
    if (box.id.startsWith("_")) continue;
    const dist = Math.sqrt(box.cx ** 2 + box.cy ** 2);
    const bearing = bearingLabel(box.cx, box.cy);
    const speedKmh = box.speed * 3.6;

    const involved = [{ label: box.label || box.type, type: box.type, dist, speed: box.speed }];
    const pos = egoPos ?? null;

    // Critical: object extremely close
    if (dist < 4 && box.type !== "sign") {
      tickets.push({
        id: ++_ticketId, time: t, frame: frameIdx, severity: "critical",
        title: `Collision Risk`,
        what: `${box.label || box.type} detected at ${dist.toFixed(1)}m ${bearing} of ego, traveling ${speedKmh.toFixed(0)} km/h. Immediate collision risk.`,
        where: `${bearing}, ${dist.toFixed(1)}m from ego (x=${box.cx.toFixed(1)}, y=${box.cy.toFixed(1)})`,
        involvedObjects: involved, egoPosition: pos, egoSpeed: null, objectId: box.id,
      });
    }
    // Warning: pedestrian/cyclist in road zone
    else if ((box.type === "pedestrian" || box.type === "cyclist") && dist < 20 && Math.abs(box.cy) < 5) {
      tickets.push({
        id: ++_ticketId, time: t, frame: frameIdx, severity: "warning",
        title: `${box.type === "pedestrian" ? "Pedestrian" : "Cyclist"} in Roadway`,
        what: `${box.label || box.type} in active lane ${bearing} at ${dist.toFixed(0)}m, lane offset ${box.cy.toFixed(1)}m. Potential crossing.`,
        where: `${bearing}, ${dist.toFixed(0)}m (lane offset ${box.cy.toFixed(1)}m)`,
        involvedObjects: involved, egoPosition: pos, egoSpeed: null, objectId: box.id,
      });
    }
    // Warning: closing vehicle
    else if (box.type === "vehicle" && box.speed > 2 && dist < 12) {
      const ttc = dist / box.speed;
      if (ttc < 3) {
        tickets.push({
          id: ++_ticketId, time: t, frame: frameIdx, severity: "warning",
          title: `Fast Closing Vehicle`,
          what: `${box.label || "Vehicle"} approaching ${bearing} at ${speedKmh.toFixed(0)} km/h, ${dist.toFixed(0)}m away. Time-to-collision: ${ttc.toFixed(1)}s.`,
          where: `${bearing}, ${dist.toFixed(0)}m`,
          involvedObjects: involved, egoPosition: pos, egoSpeed: null, objectId: box.id,
        });
      }
    }
    // Info: object entering close range
    else if (dist < 15 && dist > 10 && box.speed > 1 && box.type !== "sign") {
      tickets.push({
        id: ++_ticketId, time: t, frame: frameIdx, severity: "info",
        title: `Object Approaching`,
        what: `${box.label || box.type} detected ${bearing} at ${dist.toFixed(0)}m, speed ${speedKmh.toFixed(0)} km/h.`,
        where: `${bearing}, ${dist.toFixed(0)}m`,
        involvedObjects: involved, egoPosition: pos, egoSpeed: null, objectId: box.id,
      });
    }
  }

  return tickets;
}

// ---------------------------------------------------------------------------
// Expanded ticket detail view
// ---------------------------------------------------------------------------

function TicketDetail({ ticket, onClose }: { ticket: Ticket; onClose: () => void }) {
  return (
    <div style={{
      padding: "8px 10px", borderBottom: "1px solid rgba(255,255,255,0.06)",
      background: "rgba(255,255,255,0.02)",
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{
            fontSize: 8, fontWeight: 700,
            color: SEV_COLORS[ticket.severity],
            background: SEV_COLORS[ticket.severity] + "20",
            padding: "2px 6px", borderRadius: 3, fontFamily: fonts.mono,
          }}>
            {SEV_BADGE[ticket.severity]}
          </span>
          <span style={{ fontSize: 10, fontWeight: 600, color: colors.textPrimary }}>
            {ticket.title}
          </span>
        </div>
        <button onClick={onClose} style={{
          background: "none", border: "none", color: colors.textDim, fontSize: 10, cursor: "pointer", padding: "2px 4px",
        }}>✕</button>
      </div>

      {/* What */}
      <div style={{ fontSize: 9, color: colors.textSecondary, lineHeight: 1.5, marginBottom: 6 }}>
        {ticket.what}
      </div>

      {/* Metadata grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "3px 8px", fontSize: 8, fontFamily: fonts.mono }}>
        <div>
          <span style={{ color: colors.textDim }}>WHEN: </span>
          <span style={{ color: colors.textPrimary }}>{ticket.time.toFixed(2)}s (frame {ticket.frame})</span>
        </div>
        <div>
          <span style={{ color: colors.textDim }}>WHERE: </span>
          <span style={{ color: colors.textPrimary }}>{ticket.where}</span>
        </div>
        {ticket.egoPosition && (
          <div style={{ gridColumn: "1 / -1" }}>
            <span style={{ color: colors.textDim }}>EGO POS: </span>
            <span style={{ color: colors.textPrimary }}>
              ({ticket.egoPosition[0].toFixed(1)}, {ticket.egoPosition[1].toFixed(1)}, {ticket.egoPosition[2].toFixed(1)})
            </span>
          </div>
        )}
      </div>

      {/* Involved objects */}
      {ticket.involvedObjects.length > 0 && (
        <div style={{ marginTop: 5, borderTop: "1px solid rgba(255,255,255,0.04)", paddingTop: 4 }}>
          <div style={{ fontSize: 7, color: colors.textDim, fontFamily: fonts.mono, marginBottom: 2 }}>INVOLVED:</div>
          {ticket.involvedObjects.map((obj, i) => (
            <div key={i} style={{
              display: "flex", alignItems: "center", gap: 6,
              fontSize: 8, fontFamily: fonts.mono, color: colors.textSecondary,
              padding: "1px 0",
            }}>
              <span style={{
                width: 6, height: 6, borderRadius: 2, flexShrink: 0,
                background: obj.type === "vehicle" ? colors.boxVehicle : obj.type === "pedestrian" ? colors.boxPedestrian : obj.type === "cyclist" ? colors.boxCyclist : colors.boxUnknown,
              }} />
              <span>{obj.label}</span>
              <span style={{ color: colors.textDim }}>·</span>
              <span>{obj.dist.toFixed(1)}m</span>
              <span style={{ color: colors.textDim }}>·</span>
              <span>{(obj.speed * 3.6).toFixed(0)} km/h</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main console
// ---------------------------------------------------------------------------

export default function TicketConsole() {
  const [collapsed, setCollapsed] = useState(false);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [filter, setFilter] = useState<"all" | "critical" | "warning">("all");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastProcessedFrame = useRef(-1);
  const isPlaying = useStore((s) => s.isPlaying);

  // Auto-detect incidents each frame
  useEffect(() => {
    if (collapsed) return;
    const unsub = useStore.subscribe((state) => {
      if (!state.currentFrame) return;
      const fi = state.currentFrameIndex;
      if (fi === lastProcessedFrame.current) return;
      lastProcessedFrame.current = fi;

      const newTickets = detectIncidents(
        state.currentFrame.boxes, fi,
        state.sceneData?.fps ?? 10,
        state.currentFrame.egoPosition,
      );

      if (newTickets.length > 0) {
        setTickets((prev) => {
          const cutoff = (fi / (state.sceneData?.fps ?? 10)) - 1.0;
          const deduped = newTickets.filter((nt) => {
            if (!nt.objectId) return true;
            return !prev.some((pt) => pt.objectId === nt.objectId && pt.severity === nt.severity && pt.time > cutoff);
          });
          if (deduped.length === 0) return prev;
          return [...deduped, ...prev].slice(0, 150);
        });
      }
    });
    return unsub;
  }, [collapsed]);

  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = 0; }, [tickets.length]);

  // Scenario ticket
  const dataSource = useStore((s) => s.dataSource);
  const scenarioId = useStore((s) => s.scenarioId);
  const customScenarioName = useStore((s) => s.customScenarioName);
  const customSeverity = useStore((s) => s.customSeverity);
  const customIncident = useStore((s) => s.customIncident);

  const scenarioTicket: Ticket | null = (() => {
    if (dataSource !== "scenario") return null;
    const meta = SCENARIO_INFO[scenarioId];
    const name = customScenarioName ?? meta.label;
    const sev = customSeverity ?? meta.severity;
    const incident = customIncident ?? meta.incident;
    if (!incident || sev === "none") return null;
    return {
      id: -1, time: incident.startTime, frame: 0,
      severity: sev === "critical" ? "critical" : "warning",
      title: `Scenario: ${name}`,
      what: incident.description,
      where: "Scenario-defined location",
      involvedObjects: [], egoPosition: null, egoSpeed: null,
    };
  })();

  const actions = useStore((s) => s.actions);
  const handleSeek = useCallback((frame: number) => { actions.setFrame(frame); }, [actions]);
  const handleClear = useCallback(() => { setTickets([]); _ticketId = 0; setExpandedId(null); }, []);

  const filtered = filter === "all" ? tickets : tickets.filter((t) => t.severity === filter);
  const critCount = tickets.filter((t) => t.severity === "critical").length;
  const warnCount = tickets.filter((t) => t.severity === "warning").length;

  return (
    <div style={{
      position: "absolute", bottom: 80, right: 8, width: 300, zIndex: 10,
      background: "rgba(8,12,22,0.8)", backdropFilter: "blur(16px)",
      borderRadius: 8, border: "1px solid rgba(255,255,255,0.05)",
      overflow: "hidden", userSelect: "none",
      display: "flex", flexDirection: "column", maxHeight: 400,
    }}>
      {/* Header */}
      <div onClick={() => setCollapsed((v) => !v)} style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "5px 10px", cursor: "pointer",
        borderBottom: collapsed ? "none" : "1px solid rgba(255,255,255,0.04)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: colors.textDim, fontFamily: fonts.mono, letterSpacing: "1px" }}>
            🎫 INCIDENT TICKETS
          </span>
          {critCount > 0 && (
            <span style={{ fontSize: 8, fontWeight: 700, color: "#FF4444", background: "rgba(255,68,68,0.15)", padding: "1px 5px", borderRadius: 3, fontFamily: fonts.mono }}>
              {critCount}
            </span>
          )}
          {warnCount > 0 && (
            <span style={{ fontSize: 8, fontWeight: 700, color: "#FFB020", background: "rgba(255,176,32,0.15)", padding: "1px 5px", borderRadius: 3, fontFamily: fonts.mono }}>
              {warnCount}
            </span>
          )}
        </div>
        <span style={{ fontSize: 8, color: colors.textDim }}>{collapsed ? "▶" : "▼"}</span>
      </div>

      {!collapsed && (
        <>
          {/* Filter bar */}
          <div style={{ display: "flex", gap: 4, padding: "4px 10px", borderBottom: "1px solid rgba(255,255,255,0.04)", alignItems: "center" }}>
            {(["all", "critical", "warning"] as const).map((f) => (
              <button key={f} onClick={(e) => { e.stopPropagation(); setFilter(f); }} style={{
                padding: "2px 8px", fontSize: 8, fontFamily: fonts.mono, fontWeight: filter === f ? 600 : 400,
                color: filter === f ? (f === "critical" ? "#FF4444" : f === "warning" ? "#FFB020" : colors.accent) : colors.textDim,
                background: filter === f ? "rgba(255,255,255,0.06)" : "transparent",
                border: "1px solid rgba(255,255,255,0.04)", borderRadius: 3, cursor: "pointer", textTransform: "uppercase",
              }}>
                {f}
              </button>
            ))}
            <div style={{ flex: 1 }} />
            <button onClick={(e) => { e.stopPropagation(); handleClear(); }} style={{
              padding: "2px 6px", fontSize: 7, fontFamily: fonts.mono, color: colors.textDim,
              background: "transparent", border: "1px solid rgba(255,255,255,0.04)", borderRadius: 3, cursor: "pointer",
            }}>
              CLEAR
            </button>
          </div>

          {/* Ticket list */}
          <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", maxHeight: 310 }}>
            {/* Pinned scenario ticket */}
            {scenarioTicket && (
              <div style={{ padding: "5px 10px", borderBottom: "1px solid rgba(255,255,255,0.03)", background: "rgba(255,158,0,0.04)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ fontSize: 10 }}>📌</span>
                  <span style={{
                    fontSize: 7, fontWeight: 700, color: SEV_COLORS[scenarioTicket.severity],
                    background: SEV_COLORS[scenarioTicket.severity] + "18", padding: "1px 4px", borderRadius: 2, fontFamily: fonts.mono,
                  }}>
                    {SEV_BADGE[scenarioTicket.severity]}
                  </span>
                  <span style={{ fontSize: 9, fontWeight: 600, color: colors.textPrimary }}>{scenarioTicket.title}</span>
                </div>
                <div style={{ fontSize: 8, color: colors.textDim, marginTop: 2, fontFamily: fonts.mono, lineHeight: 1.4 }}>
                  {scenarioTicket.what}
                </div>
              </div>
            )}

            {filtered.length === 0 && !scenarioTicket && (
              <div style={{ padding: "24px 10px", textAlign: "center", fontSize: 9, color: colors.textDim, fontFamily: fonts.mono }}>
                {isPlaying ? "Monitoring for incidents…" : "Press play to start detection"}
              </div>
            )}

            {filtered.map((ticket) => (
              <div key={ticket.id}>
                {/* Compact row */}
                <div
                  onClick={() => setExpandedId(expandedId === ticket.id ? null : ticket.id)}
                  onDoubleClick={() => handleSeek(ticket.frame)}
                  style={{
                    display: "flex", gap: 6, padding: "4px 10px", cursor: "pointer",
                    borderBottom: "1px solid rgba(255,255,255,0.02)", transition: "background 0.1s",
                    background: expandedId === ticket.id ? "rgba(255,255,255,0.03)" : "transparent",
                  }}
                  onMouseEnter={(e) => { if (expandedId !== ticket.id) e.currentTarget.style.background = "rgba(255,255,255,0.02)"; }}
                  onMouseLeave={(e) => { if (expandedId !== ticket.id) e.currentTarget.style.background = "transparent"; }}
                  title="Click to expand · Double-click to seek"
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <span style={{
                        fontSize: 7, fontWeight: 700, color: SEV_COLORS[ticket.severity],
                        background: SEV_COLORS[ticket.severity] + "18",
                        padding: "1px 4px", borderRadius: 2, fontFamily: fonts.mono, flexShrink: 0,
                      }}>
                        {SEV_BADGE[ticket.severity]}
                      </span>
                      <span style={{ fontSize: 8, fontWeight: 600, color: colors.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {ticket.title}
                      </span>
                      <span style={{ fontSize: 7, color: colors.textDim, fontFamily: fonts.mono, flexShrink: 0, marginLeft: "auto" }}>
                        {ticket.time.toFixed(1)}s
                      </span>
                    </div>
                    <div style={{ fontSize: 7, color: colors.textDim, fontFamily: fonts.mono, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {ticket.where}
                    </div>
                  </div>
                </div>
                {/* Expanded detail */}
                {expandedId === ticket.id && (
                  <TicketDetail ticket={ticket} onClose={() => setExpandedId(null)} />
                )}
              </div>
            ))}
          </div>

          {/* Footer */}
          <div style={{
            padding: "3px 10px", borderTop: "1px solid rgba(255,255,255,0.04)",
            display: "flex", justifyContent: "space-between", fontSize: 7, fontFamily: fonts.mono, color: colors.textDim,
          }}>
            <span>Total: {tickets.length}</span>
            <span>
              {critCount > 0 && <span style={{ color: "#FF4444" }}>{critCount} crit</span>}
              {critCount > 0 && warnCount > 0 && " · "}
              {warnCount > 0 && <span style={{ color: "#FFB020" }}>{warnCount} warn</span>}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
