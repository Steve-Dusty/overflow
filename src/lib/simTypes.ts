/**
 * Simulation data model for counterfactual runs.
 */

import type { OpenEnvAction, OpenEnvOutput } from "./openenvClient";

export interface EgoSnapshot {
  x: number;
  y: number;
  z: number;
  heading: number;
  speed: number;
  frameIndex: number;
}

export interface SimMetrics {
  cumulativeReward: number;
  interventionCount: number;
  minTTC: number;       // min time-to-collision proxy (seconds)
  avgReward: number;
  deltaVsMain: number;  // reward delta compared to main sim
}

export type SimStatus = "running" | "finished" | "replaced";

export interface CounterfactualRun {
  id: string;
  label: string;        // "Counterfactual A", etc.
  branchId: string;
  seed: number;         // unique PRNG seed — drives action divergence
  createdAt: number;    // timestamp
  startFrameIndex: number;
  currentFrameIndex: number;
  status: SimStatus;

  // The ego action stream (differs from main)
  actionStream: OpenEnvOutput[];

  // Ego trajectory (diverges from main based on actions)
  egoTrajectory: EgoSnapshot[];

  // Computed metrics
  metrics: SimMetrics;
}

export interface MainSimState {
  scenarioId: string;
  frameIndex: number;
  egoSnapshot: EgoSnapshot;
  nearestObjectDist: number;
  // Main sim's own action/reward from OpenEnv
  lastAction: OpenEnvOutput | null;
  cumulativeReward: number;
}

// Utility to compute ego position delta based on action
export function applyAction(
  ego: EgoSnapshot,
  action: OpenEnvAction,
  dt: number,
): EgoSnapshot {
  let { x, y, z, heading, speed } = ego;
  const frameIndex = ego.frameIndex + 1;

  switch (action) {
    case "keep_lane":
      break;
    case "brake_mild":
      speed = Math.max(0, speed - 1.5 * dt);
      break;
    case "brake_hard":
      speed = Math.max(0, speed - 4.0 * dt);
      break;
    case "accelerate":
      speed = Math.min(speed + 2.0 * dt, 30);
      break;
    case "merge_left":
      y += 1.85 * dt;
      break;
    case "merge_right":
      y -= 1.85 * dt;
      break;
    case "yield":
      speed = Math.max(0, speed - 2.0 * dt);
      break;
    case "nudge_left":
      y += 0.5 * dt;
      break;
    case "nudge_right":
      y -= 0.5 * dt;
      break;
  }

  // Move forward
  x += speed * dt * Math.cos(heading);
  y += speed * dt * Math.sin(heading);

  return { x, y, z, heading, speed, frameIndex };
}

let _runCounter = 0;

export function createCounterfactualRun(
  label: string,
  branchId: string,
  seed: number,
  startFrame: number,
  egoStart: EgoSnapshot,
  initialAction: OpenEnvOutput,
): CounterfactualRun {
  _runCounter++;
  return {
    id: `cf-${_runCounter}-${Date.now().toString(36)}`,
    label,
    branchId,
    seed,
    createdAt: Date.now(),
    startFrameIndex: startFrame,
    currentFrameIndex: startFrame,
    status: "running",
    actionStream: [initialAction],
    egoTrajectory: [egoStart],
    metrics: {
      cumulativeReward: initialAction.reward,
      interventionCount: 0,
      minTTC: 999,
      avgReward: initialAction.reward,
      deltaVsMain: 0,
    },
  };
}

export function advanceRun(
  run: CounterfactualRun,
  newAction: OpenEnvOutput,
  mainReward: number,
): CounterfactualRun {
  const lastEgo = run.egoTrajectory[run.egoTrajectory.length - 1];
  const newEgo = applyAction(lastEgo, newAction.action, 0.1);

  const newStream = [...run.actionStream, newAction];
  const newTrajectory = [...run.egoTrajectory, newEgo];
  const cumReward = run.metrics.cumulativeReward + newAction.reward;
  const avgReward = cumReward / newStream.length;

  // Simple TTC proxy: if speed > 0 and dist < 20, estimate TTC
  const dist = Math.sqrt(newEgo.x * newEgo.x + newEgo.y * newEgo.y);
  const ttcEstimate = newEgo.speed > 0.5 ? dist / newEgo.speed : 999;
  const minTTC = Math.min(run.metrics.minTTC, ttcEstimate);

  const interventions = run.metrics.interventionCount +
    (newAction.action === "brake_hard" ? 1 : 0);

  return {
    ...run,
    currentFrameIndex: newEgo.frameIndex,
    actionStream: newStream,
    egoTrajectory: newTrajectory,
    metrics: {
      cumulativeReward: Math.round(cumReward * 1000) / 1000,
      interventionCount: interventions,
      minTTC: Math.round(minTTC * 100) / 100,
      avgReward: Math.round(avgReward * 1000) / 1000,
      deltaVsMain: Math.round((cumReward - mainReward) * 1000) / 1000,
    },
  };
}
