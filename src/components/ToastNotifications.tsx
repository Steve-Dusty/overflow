/**
 * ToastNotifications — Floating toast alerts that appear when incidents are
 * detected. Replaces the permanent TicketConsole panel. Toasts auto-dismiss
 * after a few seconds and stack from the bottom-right.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useStore } from "../store";
import { colors, fonts } from "../theme";
import type { BBox3D } from "../mockData";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Toast {
  id: number;
  time: number;
  frame: number;
  severity: "info" | "warning" | "critical";
  title: string;
  detail: string;
  objectId?: string;
  createdAt: number;
}

// Ticket data stored for the Analytics panel
export interface TicketRecord {
  id: number;
  time: number;
  frame: number;
  severity: "info" | "warning" | "critical";
  title: string;
  what: string;
  where: string;
  involvedObjects: { label: string; type: string; dist: number; speed: number }[];
  egoPosition: [number, number, number] | null;
  objectId?: string;
}

const SEV_COLORS: Record<string, string> = {
  info: colors.accentBlue,
  warning: "#FFB020",
  critical: "#FF4444",
};

const SEV_ICONS: Record<string, string> = {
  info: "ℹ️",
  warning: "⚠️",
  critical: "🚨",
};

const TOAST_DURATION = 5000; // ms
const MAX_TOASTS = 4;

let _toastId = 0;

// ---------------------------------------------------------------------------
// Shared ticket log (accessible from Analytics)
// ---------------------------------------------------------------------------

const _ticketLog: TicketRecord[] = [];
const _ticketListeners: Set<() => void> = new Set();

export function getTicketLog(): TicketRecord[] {
  return _ticketLog;
}

export function clearTicketLog() {
  _ticketLog.length = 0;
  _ticketListeners.forEach((fn) => fn());
}

export function subscribeTicketLog(fn: () => void): () => void {
  _ticketListeners.add(fn);
  return () => { _ticketListeners.delete(fn); };
}

function addTicketRecord(record: TicketRecord) {
  _ticketLog.unshift(record);
  if (_ticketLog.length > 500) _ticketLog.length = 500;
  _ticketListeners.forEach((fn) => fn());
}

// ---------------------------------------------------------------------------
// Detection logic
// ---------------------------------------------------------------------------

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

interface RawIncident {
  severity: "info" | "warning" | "critical";
  title: string;
  what: string;
  where: string;
  objectId: string;
  involved: { label: string; type: string; dist: number; speed: number }[];
}

function detectIncidents(
  boxes: BBox3D[],
  egoPos: [number, number, number] | undefined,
): RawIncident[] {
  const incidents: RawIncident[] = [];

  for (const box of boxes) {
    if (box.id.startsWith("_")) continue;
    const dist = Math.sqrt(box.cx ** 2 + box.cy ** 2);
    const bearing = bearingLabel(box.cx, box.cy);
    const speedKmh = box.speed * 3.6;
    const involved = [{ label: box.label || box.type, type: box.type, dist, speed: box.speed }];

    if (dist < 4 && box.type !== "sign") {
      incidents.push({
        severity: "critical",
        title: "Collision Risk",
        what: `${box.label || box.type} at ${dist.toFixed(1)}m ${bearing}, ${speedKmh.toFixed(0)} km/h`,
        where: `${bearing}, ${dist.toFixed(1)}m`,
        objectId: box.id,
        involved,
      });
    } else if ((box.type === "pedestrian" || box.type === "cyclist") && dist < 20 && Math.abs(box.cy) < 5) {
      incidents.push({
        severity: "warning",
        title: `${box.type === "pedestrian" ? "Pedestrian" : "Cyclist"} in Roadway`,
        what: `${box.label || box.type} ${bearing} at ${dist.toFixed(0)}m, offset ${box.cy.toFixed(1)}m`,
        where: `${bearing}, ${dist.toFixed(0)}m`,
        objectId: box.id,
        involved,
      });
    } else if (box.type === "vehicle" && box.speed > 2 && dist < 12) {
      const ttc = dist / box.speed;
      if (ttc < 3) {
        incidents.push({
          severity: "warning",
          title: "Fast Closing Vehicle",
          what: `${box.label || "Vehicle"} ${bearing} at ${speedKmh.toFixed(0)} km/h, TTC ${ttc.toFixed(1)}s`,
          where: `${bearing}, ${dist.toFixed(0)}m`,
          objectId: box.id,
          involved,
        });
      }
    }
  }

  return incidents;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ToastNotifications() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const lastProcessedFrame = useRef(-1);
  const recentObjectMap = useRef<Map<string, number>>(new Map());

  // Auto-detect incidents each frame
  useEffect(() => {
    const unsub = useStore.subscribe((state) => {
      if (!state.currentFrame || !state.isPlaying) return;
      const fi = state.currentFrameIndex;
      if (fi === lastProcessedFrame.current) return;
      lastProcessedFrame.current = fi;

      const fps = state.sceneData?.fps ?? 10;
      const t = fi / fps;
      const incidents = detectIncidents(state.currentFrame.boxes, state.currentFrame.egoPosition);

      const now = Date.now();
      const newToasts: Toast[] = [];

      for (const inc of incidents) {
        // Deduplicate: same object + severity within 2 seconds
        const lastTime = recentObjectMap.current.get(`${inc.objectId}_${inc.severity}`);
        if (lastTime && (t - lastTime) < 2) continue;
        recentObjectMap.current.set(`${inc.objectId}_${inc.severity}`, t);

        const id = ++_toastId;
        newToasts.push({
          id,
          time: t,
          frame: fi,
          severity: inc.severity,
          title: inc.title,
          detail: inc.what,
          objectId: inc.objectId,
          createdAt: now,
        });

        // Also log to the shared ticket log for Analytics
        addTicketRecord({
          id,
          time: t,
          frame: fi,
          severity: inc.severity,
          title: inc.title,
          what: inc.what,
          where: inc.where,
          involvedObjects: inc.involved,
          egoPosition: state.currentFrame.egoPosition ?? null,
          objectId: inc.objectId,
        });
      }

      if (newToasts.length > 0) {
        setToasts((prev) => [...newToasts, ...prev].slice(0, MAX_TOASTS));
      }
    });
    return unsub;
  }, []);

  // Auto-dismiss toasts
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setToasts((prev) => prev.filter((t) => now - t.createdAt < TOAST_DURATION));
    }, 500);
    return () => clearInterval(interval);
  }, []);

  // Click to seek
  const actions = useStore((s) => s.actions);
  const handleClick = useCallback((frame: number) => {
    actions.setFrame(frame);
    actions.setPlaying(false);
  }, [actions]);

  const handleDismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div style={{
      position: "absolute",
      bottom: 80,
      right: 12,
      zIndex: 50,
      display: "flex",
      flexDirection: "column-reverse",
      gap: 8,
      pointerEvents: "none",
      maxWidth: 360,
    }}>
      {toasts.map((toast, i) => {
        const age = Date.now() - toast.createdAt;
        const fadeIn = Math.min(1, age / 200);
        const fadeOut = Math.max(0, 1 - Math.max(0, age - (TOAST_DURATION - 800)) / 800);
        const opacity = Math.min(fadeIn, fadeOut);
        const sevColor = SEV_COLORS[toast.severity];

        return (
          <div
            key={toast.id}
            onClick={() => handleClick(toast.frame)}
            style={{
              pointerEvents: "auto",
              cursor: "pointer",
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              padding: "10px 14px",
              background: `linear-gradient(135deg, rgba(12,15,26,0.92), rgba(12,15,26,0.85))`,
              backdropFilter: "blur(20px)",
              border: `1px solid ${sevColor}40`,
              borderLeft: `3px solid ${sevColor}`,
              borderRadius: 10,
              fontFamily: fonts.sans,
              opacity,
              transform: `translateX(${(1 - fadeIn) * 40}px)`,
              transition: "transform 0.2s ease-out",
              boxShadow: `0 4px 24px rgba(0,0,0,0.4), 0 0 20px ${sevColor}10`,
              animation: toast.severity === "critical" && age < 1000
                ? "toastPulse 0.5s ease-in-out" : undefined,
              userSelect: "none",
            }}
          >
            <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>
              {SEV_ICONS[toast.severity]}
            </span>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                <span style={{
                  fontSize: 7, fontWeight: 700, color: sevColor,
                  background: `${sevColor}20`,
                  padding: "1px 5px", borderRadius: 3, fontFamily: fonts.mono,
                  letterSpacing: "0.8px", textTransform: "uppercase",
                }}>
                  {toast.severity}
                </span>
                <span style={{
                  fontSize: 10, fontWeight: 600, color: colors.textPrimary,
                }}>
                  {toast.title}
                </span>
              </div>
              <div style={{
                fontSize: 9, color: colors.textSecondary, fontFamily: fonts.mono,
                lineHeight: 1.4,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {toast.detail}
              </div>
              <div style={{
                fontSize: 7, color: colors.textDim, fontFamily: fonts.mono, marginTop: 2,
              }}>
                {toast.time.toFixed(1)}s · frame {toast.frame} · click to seek
              </div>
            </div>

            <button
              onClick={(e) => { e.stopPropagation(); handleDismiss(toast.id); }}
              style={{
                background: "none", border: "none", color: colors.textDim,
                fontSize: 10, cursor: "pointer", padding: "2px 4px",
                pointerEvents: "auto", flexShrink: 0,
              }}
            >
              ✕
            </button>
          </div>
        );
      })}

      <style>{`
        @keyframes toastPulse {
          0% { transform: translateX(40px) scale(0.95); opacity: 0; }
          50% { transform: translateX(-5px) scale(1.02); }
          100% { transform: translateX(0) scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
