/**
 * trajectoryData — Generates trajectory candidate data for the planner/observer
 * visualization. Each "moment" has:
 *   - Past ego trajectory
 *   - 3 candidate future trajectories with preference scores (0-10)
 *   - Best/worst candidate indices
 * 
 * This data is generated from the current SceneData (mock or Waymo) by
 * extracting the ego trajectory and creating synthetic candidates.
 */

import type { SceneData } from "../mockData";

export interface TrajectoryPoint {
  x: number;
  y: number;
  yaw: number;
  t: number;
}

export interface TrajectoryCandidate {
  id: number;
  points: TrajectoryPoint[];
  score: number; // 0-10, higher = better
  label: string;
}

export interface TrajectoryMoment {
  id: string;
  frameIndex: number;
  pastTrajectory: TrajectoryPoint[];
  candidates: TrajectoryCandidate[];
  bestCandidateIndex: number;
  worstCandidateIndex: number;
}

export type PlannerPolicy = "worst" | "random" | "best";
export type ObserverPolicy = "best" | "mimic_planner" | "heuristic";

/**
 * Get the planner's choice for a moment
 */
export function getPlannerChoice(moment: TrajectoryMoment, policy: PlannerPolicy): number {
  switch (policy) {
    case "worst":
      return moment.worstCandidateIndex;
    case "best":
      return moment.bestCandidateIndex;
    case "random":
      return Math.floor(Math.random() * moment.candidates.length);
    default:
      return moment.worstCandidateIndex;
  }
}

/**
 * Get the observer's choice for a moment
 */
export function getObserverChoice(
  moment: TrajectoryMoment,
  policy: ObserverPolicy,
  plannerChoice: number,
): number {
  switch (policy) {
    case "best":
      return moment.bestCandidateIndex;
    case "mimic_planner":
      return plannerChoice;
    case "heuristic": {
      // 80% best, 20% second-best
      if (Math.random() < 0.8) return moment.bestCandidateIndex;
      const sorted = [...moment.candidates].sort((a, b) => b.score - a.score);
      if (sorted.length > 1) {
        return moment.candidates.indexOf(sorted[1]);
      }
      return moment.bestCandidateIndex;
    }
    default:
      return moment.bestCandidateIndex;
  }
}

/**
 * Generate trajectory moments from SceneData
 * Creates moments every N frames with past trajectory + 3 future candidates
 */
export function generateTrajectoryMoments(
  sceneData: SceneData,
  intervalFrames: number = 20, // generate a moment every 2 seconds
): TrajectoryMoment[] {
  const moments: TrajectoryMoment[] = [];
  const frames = sceneData.frames;
  const fps = sceneData.fps;
  const pastFrameCount = 20; // 2 seconds of past
  const futureFrameCount = 30; // 3 seconds of future

  for (let fi = pastFrameCount; fi < frames.length - futureFrameCount; fi += intervalFrames) {
    // Build past trajectory
    const past: TrajectoryPoint[] = [];
    for (let pi = Math.max(0, fi - pastFrameCount); pi <= fi; pi++) {
      const f = frames[pi];
      past.push({
        x: f.egoPosition[0],
        y: f.egoPosition[1],
        yaw: f.egoYaw,
        t: f.timestamp,
      });
    }

    // Build the "ground truth" future trajectory
    const futureGT: TrajectoryPoint[] = [];
    for (let fj = fi + 1; fj <= Math.min(fi + futureFrameCount, frames.length - 1); fj++) {
      const f = frames[fj];
      futureGT.push({
        x: f.egoPosition[0],
        y: f.egoPosition[1],
        yaw: f.egoYaw,
        t: f.timestamp,
      });
    }

    if (futureGT.length < 5) continue;

    // Generate 3 candidate trajectories
    const currentFrame = frames[fi];
    const baseX = currentFrame.egoPosition[0];
    const baseY = currentFrame.egoPosition[1];
    const baseYaw = currentFrame.egoYaw;

    const candidates: TrajectoryCandidate[] = [];

    // Candidate 0: "Safe" — follows ground truth closely (highest score)
    const safePoints: TrajectoryPoint[] = futureGT.map((p, i) => ({
      x: p.x + Math.sin(i * 0.1) * 0.3,
      y: p.y + Math.cos(i * 0.15) * 0.2,
      yaw: p.yaw,
      t: p.t,
    }));
    candidates.push({
      id: 0,
      points: safePoints,
      score: 7.5 + Math.random() * 2.5, // 7.5 - 10
      label: "Conservative",
    });

    // Candidate 1: "Moderate" — slight lateral offset
    const modPoints: TrajectoryPoint[] = futureGT.map((p, i) => {
      const drift = Math.sin((i / futureGT.length) * Math.PI) * 2.5;
      return {
        x: p.x + Math.sin(i * 0.08) * 0.5,
        y: p.y + drift,
        yaw: p.yaw + drift * 0.02,
        t: p.t,
      };
    });
    candidates.push({
      id: 1,
      points: modPoints,
      score: 4.0 + Math.random() * 3.0, // 4 - 7
      label: "Moderate",
    });

    // Candidate 2: "Aggressive" — larger deviation (lowest score)
    const aggPoints: TrajectoryPoint[] = futureGT.map((p, i) => {
      const drift = Math.sin((i / futureGT.length) * Math.PI * 1.5) * 5.0;
      const speedup = 1.1;
      return {
        x: p.x * speedup + Math.cos(i * 0.12) * 1.0,
        y: p.y + drift,
        yaw: p.yaw + drift * 0.04,
        t: p.t,
      };
    });
    candidates.push({
      id: 2,
      points: aggPoints,
      score: 1.0 + Math.random() * 3.0, // 1 - 4
      label: "Aggressive",
    });

    // Sort to find best/worst
    const sortedByScore = [...candidates].sort((a, b) => b.score - a.score);
    const bestIdx = candidates.indexOf(sortedByScore[0]);
    const worstIdx = candidates.indexOf(sortedByScore[sortedByScore.length - 1]);

    moments.push({
      id: `moment_${fi}`,
      frameIndex: fi,
      pastTrajectory: past,
      candidates,
      bestCandidateIndex: bestIdx,
      worstCandidateIndex: worstIdx,
    });
  }

  return moments;
}

// Trajectory colors
export const CANDIDATE_COLORS = [
  "#00E89D", // green — conservative/safe
  "#FFB020", // orange — moderate
  "#FF4444", // red — aggressive
];

export const PAST_TRAJECTORY_COLOR = "#4DA8FF";
