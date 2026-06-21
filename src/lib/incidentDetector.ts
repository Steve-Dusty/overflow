/**
 * Incident detection — analyzes SceneData to find incidents.
 * Rule-based for MVP. Detects hard braking, near-misses, close calls, etc.
 */

import type { SceneData } from "../mockData";
import type { Incident, IncidentType, Severity } from "./types";

interface DetectionConfig {
  minTTC: number;          // flag if TTC drops below this (seconds)
  hardBrakingThreshold: number; // m/s² deceleration
  closeClearance: number;  // meters
  laneDepartureOffset: number; // meters from center
}

const DEFAULT_CONFIG: DetectionConfig = {
  minTTC: 3.0,
  hardBrakingThreshold: 3.5,
  closeClearance: 2.0,
  laneDepartureOffset: 1.5,
};

function classifySeverity(ttc: number, clearance: number, decel: number): Severity {
  if (ttc < 1.0 || clearance < 0.5) return "critical";
  if (ttc < 2.0 || clearance < 1.0 || decel > 6.0) return "high";
  if (ttc < 3.0 || clearance < 2.0 || decel > 4.0) return "medium";
  return "low";
}

function classifyType(ttc: number, clearance: number, decel: number, lateralOffset: number): IncidentType {
  if (clearance < 0.3) return "collision";
  if (ttc < 1.5 && clearance < 1.5) return "near_miss";
  if (decel > 5.0) return "hard_braking";
  if (lateralOffset > 1.5) return "lane_departure";
  if (clearance < 2.5) return "close_call";
  return "erratic_agent";
}

const TYPE_TITLES: Record<IncidentType, string> = {
  hard_braking: "Hard Braking Event",
  near_miss: "Near-Miss Detected",
  collision: "Collision Event",
  lane_departure: "Lane Departure",
  close_call: "Close Call",
  erratic_agent: "Erratic Agent Behavior",
};

export function detectIncidents(
  sceneData: SceneData,
  config: DetectionConfig = DEFAULT_CONFIG,
): Incident[] {
  const incidents: Incident[] = [];
  const frames = sceneData.frames;
  const fps = sceneData.fps;

  // Cooldown: don't flag overlapping incidents
  let lastIncidentFrame = -30;

  for (let fi = 1; fi < frames.length; fi++) {
    const frame = frames[fi];
    const prevFrame = frames[fi - 1];
    const time = fi / fps;

    // Skip if too close to last incident
    if (fi - lastIncidentFrame < 20) continue;

    // Compute ego speed change (deceleration)
    const dx = frame.egoPosition[0] - prevFrame.egoPosition[0];
    const dy = frame.egoPosition[1] - prevFrame.egoPosition[1];
    const speed = Math.sqrt(dx * dx + dy * dy) * fps;

    const prevDx = fi > 1 ? prevFrame.egoPosition[0] - frames[fi - 2].egoPosition[0] : dx;
    const prevDy = fi > 1 ? prevFrame.egoPosition[1] - frames[fi - 2].egoPosition[1] : dy;
    const prevSpeed = Math.sqrt(prevDx * prevDx + prevDy * prevDy) * fps;
    const decel = Math.max(0, (prevSpeed - speed) * fps);

    // Find nearest agent
    let minClearance = 100;
    let nearestAgentSpeed = 0;
    for (const box of frame.boxes) {
      const dist = Math.sqrt(box.cx * box.cx + box.cy * box.cy);
      if (dist < minClearance) {
        minClearance = dist;
        nearestAgentSpeed = box.speed ?? 0;
      }
    }

    // Estimate TTC
    const closingSpeed = Math.max(0.1, speed - nearestAgentSpeed * Math.cos(0));
    const ttc = minClearance / closingSpeed;

    // Lateral offset from lane center (ego Y position)
    const lateralOffset = Math.abs(frame.egoPosition[1]);

    // Check if this qualifies as an incident
    const isIncident =
      ttc < config.minTTC ||
      decel > config.hardBrakingThreshold ||
      minClearance < config.closeClearance ||
      lateralOffset > config.laneDepartureOffset;

    if (!isIncident) continue;

    const type = classifyType(ttc, minClearance, decel, lateralOffset);
    const severity = classifySeverity(ttc, minClearance, decel);

    incidents.push({
      id: `inc-${fi}-${type}`,
      frameIndex: fi,
      time,
      type,
      severity,
      title: TYPE_TITLES[type],
      description: generateDescription(type, ttc, minClearance, decel, speed),
      metrics: {
        ttc: Math.round(ttc * 100) / 100,
        deceleration: Math.round(decel * 100) / 100,
        lateralOffset: Math.round(lateralOffset * 100) / 100,
        minClearance: Math.round(minClearance * 100) / 100,
        egoSpeed: Math.round(speed * 100) / 100,
      },
    });

    lastIncidentFrame = fi;
  }

  return incidents;
}

function generateDescription(
  type: IncidentType,
  ttc: number,
  clearance: number,
  decel: number,
  speed: number,
): string {
  switch (type) {
    case "collision":
      return `Ego vehicle at ${speed.toFixed(1)} m/s with agent clearance of ${clearance.toFixed(1)}m. Estimated TTC ${ttc.toFixed(1)}s at time of detection.`;
    case "near_miss":
      return `Near-miss event — minimum clearance ${clearance.toFixed(1)}m, TTC dropped to ${ttc.toFixed(1)}s. Ego speed ${speed.toFixed(1)} m/s.`;
    case "hard_braking":
      return `Hard braking detected — ${decel.toFixed(1)} m/s² deceleration at ${speed.toFixed(1)} m/s. Nearest agent ${clearance.toFixed(1)}m.`;
    case "lane_departure":
      return `Ego vehicle departed lane center. Nearest agent ${clearance.toFixed(1)}m, TTC ${ttc.toFixed(1)}s.`;
    case "close_call":
      return `Close proximity event — agent within ${clearance.toFixed(1)}m. TTC ${ttc.toFixed(1)}s, ego speed ${speed.toFixed(1)} m/s.`;
    case "erratic_agent":
      return `Erratic agent behavior detected near ego vehicle. Clearance ${clearance.toFixed(1)}m, TTC ${ttc.toFixed(1)}s.`;
  }
}
