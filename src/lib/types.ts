/**
 * Pipeline types — Overflow incident forensics + GRPO training platform.
 */

import type { ScenarioId, SceneVariant } from "../mockData";

// ---------------------------------------------------------------------------
// Pipeline stages
// ---------------------------------------------------------------------------

export type PipelineStage = "upload" | "analysis" | "compare" | "train" | "export";

// ---------------------------------------------------------------------------
// Incidents
// ---------------------------------------------------------------------------

export type IncidentType =
  | "hard_braking"
  | "near_miss"
  | "collision"
  | "lane_departure"
  | "close_call"
  | "erratic_agent";

export type Severity = "low" | "medium" | "high" | "critical";

export interface IncidentMetrics {
  ttc: number;            // time-to-collision (seconds)
  deceleration: number;   // m/s²
  lateralOffset: number;  // meters from lane center
  minClearance: number;   // min distance to nearest agent (meters)
  egoSpeed: number;       // m/s at incident time
}

export interface Incident {
  id: string;
  frameIndex: number;
  time: number;
  type: IncidentType;
  severity: Severity;
  title: string;
  description: string;
  metrics: IncidentMetrics;
  llmAnalysis?: string;
}

// ---------------------------------------------------------------------------
// Trajectory options for preference collection
// ---------------------------------------------------------------------------

export interface TrajectoryOption {
  id: number;
  label: string;
  description: string;
  action: string;
  color: string;
  variant: SceneVariant;
  reward: number;
  safety: number;
  ttc: number;
  status: "optimal" | "suboptimal" | "dangerous";
}

// ---------------------------------------------------------------------------
// Preferences (RLHF training data)
// ---------------------------------------------------------------------------

export interface Preference {
  id: string;
  incidentId: string;
  scenarioId: ScenarioId;
  options: TrajectoryOption[];
  selectedOptionId: number;
  timestamp: number;
}

export interface PreferencePair {
  winId: number;
  loseId: number;
  scenarioId: ScenarioId;
  incidentId: string;
}

// ---------------------------------------------------------------------------
// Training metrics
// ---------------------------------------------------------------------------

export type TrainingPhase = "reward_model" | "grpo" | "eval";

export interface TrainingMetric {
  step: number;
  epoch: number;
  phase: TrainingPhase;
  loss: number;
  avgReward: number;
  collisionRate: number;
  avgTTC: number;
  kl: number;
  gradNorm: number;
  lr: number;
  timestamp: number;
}

export interface EvalComparison {
  metric: string;
  before: number;
  after: number;
  unit: string;
  improved: boolean;
}

export interface TrainedModel {
  version: string;
  name: string;
  trainedAt: number;
  preferences: number;
  epochs: number;
  steps: number;
  evalMetrics: {
    avgReward: number;
    collisionRate: number;
    avgTTC: number;
    safetyScore: number;
  };
  comparisons: EvalComparison[];
}

// ---------------------------------------------------------------------------
// Dataset info (for upload)
// ---------------------------------------------------------------------------

export interface DatasetInfo {
  name: string;
  source: "mock" | "uploaded" | "demo";
  fileCount: number;
  totalFrames: number;
  duration: number; // seconds
  scenarioId: ScenarioId;
  incidents: Incident[];
  analyzedAt: number;
}
