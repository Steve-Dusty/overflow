/**
 * GraphPage — RL Architecture visualization showing the Overflow
 * reinforcement learning pipeline: Environment → Observation → Policy →
 * Action → Reward → State Transition, with counterfactual branching.
 */

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import ForceGraph3D from "react-force-graph-3d";
import * as THREE from "three";
import { useNavigate } from "react-router-dom";
import { X, GitBranch, Activity, Cpu, Layers, MessageCircle, Send, Play, ArrowRight } from "lucide-react";
import Badge from "../components/ui/Badge";
import { colors, fonts, typeScale, spacing, radius } from "../theme";
import { getApiKey, setApiKey } from "../utils/scenarioAI";
import { useStore } from "../store";
import { SCENARIO_INFO, VARIANT_INFO, VARIANT_METRICS } from "../mockData";
import type { ScenarioId, SceneVariant } from "../mockData";

/* ---------- Graph types ---------- */

type RLNodeType =
  | "environment"
  | "sensor"
  | "observation"
  | "policy"
  | "policy_variant"
  | "action"
  | "reward"
  | "metric"
  | "branching"
  | "state";

interface GraphNode {
  id: string;
  label: string;
  type: RLNodeType;
  val: number;
  color: string;
  details?: Record<string, string | number>;
  description?: string;
}

interface GraphLink {
  source: string;
  target: string;
  label: string;
  color: string;
}

interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

const NODE_COLORS: Record<RLNodeType, string> = {
  environment: "#60A5FA",
  sensor: "#00C9DB",
  observation: "#4DA8FF",
  policy: "#A78BFA",
  policy_variant: "#C084FC",
  action: "#00E89D",
  reward: "#FBBF24",
  metric: "#6EE7B7",
  branching: "#FF9E00",
  state: "#F472B6",
};

const NODE_ICONS: Record<RLNodeType, string> = {
  environment: "\u25C6",
  sensor: "\u25C9",
  observation: "\u25CB",
  policy: "\u2B22",
  policy_variant: "\u25B7",
  action: "\u2BC1",
  reward: "\u2736",
  metric: "\u25A0",
  branching: "\u2442",
  state: "\u21BB",
};

const NODE_LABELS: Record<RLNodeType, string> = {
  environment: "environment",
  sensor: "sensor",
  observation: "observation",
  policy: "policy",
  policy_variant: "policy variant",
  action: "action",
  reward: "reward",
  metric: "metric",
  branching: "branching",
  state: "state",
};

// Primary representative node for each type (used for chip navigation)
const TYPE_PRIMARY_NODE: Record<RLNodeType, string> = {
  environment: "env-waymo",
  sensor: "sensor-lidar",
  observation: "obs-vector",
  policy: "policy-planner",
  policy_variant: "pv-planner-best",
  action: "action-brake_hard",
  reward: "reward-aggregator",
  metric: "metric-ttc",
  branching: "branch-engine",
  state: "state-transition",
};

/* ---------- Shared THREE.js geometries ---------- */

const SPHERE_GEO = new THREE.SphereGeometry(1, 32, 16);
const GLOW_GEO = new THREE.SphereGeometry(1, 16, 8);
const RING_GEO = new THREE.TorusGeometry(1, 0.06, 8, 48);
const OCTA_GEO = new THREE.OctahedronGeometry(1, 0);
const ICO_GEO = new THREE.IcosahedronGeometry(1, 0);
const CONE_GEO = new THREE.ConeGeometry(0.7, 1.5, 8);
const BOX_GEO = new THREE.BoxGeometry(1, 1, 1);
const DODECA_GEO = new THREE.DodecahedronGeometry(1, 0);
const TORUS_KNOT_GEO = new THREE.TorusKnotGeometry(0.8, 0.25, 64, 8);
const TORUS_STATE_GEO = new THREE.TorusGeometry(0.8, 0.3, 16, 32);

/* ---------- Build static RL architecture graph ---------- */

function buildRLArchitectureGraph(): GraphData {
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];

  const n = (id: string, label: string, type: RLNodeType, val: number, details: Record<string, string | number>, description: string) => {
    nodes.push({ id, label, type, val, color: NODE_COLORS[type], details, description });
  };
  const e = (source: string, target: string, label: string, color: string) => {
    links.push({ source, target, label, color });
  };

  /* ---- Layer 1: Environment ---- */
  n("env-waymo", "Waymo Scene Environment", "environment", 18,
    { type: "Simulation Environment", frameRate: "10 Hz", duration: "20s segments", actors: "vehicles, pedestrians, cyclists" },
    "Root environment node representing the Waymo Open Dataset driving scene. Provides 3D LiDAR point clouds, actor bounding boxes, and ego vehicle telemetry at 10 Hz across 20-second segments.");

  const scenarios = [
    ["env-normal", "Normal Driving", "low", "Routine highway/urban traffic with no hazards"],
    ["env-near_miss", "Near Miss", "critical", "Vehicle swerves into ego lane at 8.0s — collision avoidance required"],
    ["env-rear_end", "Rear End", "critical", "Lead vehicle emergency brakes at 6.0s — hard stop needed"],
    ["env-jaywalker", "Jaywalker", "critical", "Pedestrian darts across roadway at 7.0s — immediate yield"],
    ["env-red_light", "Red Light Runner", "critical", "Cross traffic violates intersection signal at 9.0s"],
    ["env-swerving", "Swerving Vehicle", "warning", "Adjacent vehicle driving erratically for extended duration"],
  ] as const;
  for (const [id, label, risk, desc] of scenarios) {
    n(id, label, "environment", 6, { riskLevel: risk, type: "scenario" }, desc);
    e("env-waymo", id, "scenario_type", "rgba(96,165,250,0.25)");
  }

  /* ---- Layer 2: Sensors & Perception ---- */
  n("sensor-lidar", "LiDAR 64-Beam Scanner", "sensor", 10,
    { beams: 64, maxRange: "75m", columns: 2650, fov: "360\u00b0 horizontal" },
    "64-beam rotating LiDAR generating ~150K points per frame. Scans \u00b125\u00b0 vertical, 360\u00b0 horizontal at 75m max range with intensity and elongation attributes.");
  n("sensor-bbox", "BBox3D Object Detector", "sensor", 9,
    { types: "vehicle, pedestrian, cyclist, sign", output: "cx, cy, cz, dx, dy, dz, heading, speed" },
    "3D bounding box detection module. Classifies actors as vehicle/pedestrian/cyclist/sign and outputs ego-relative position, dimensions, heading, and velocity.");
  n("sensor-ego", "Ego State Encoder", "sensor", 9,
    { outputs: "x, y, z, heading, speed", source: "IMU + GNSS fusion" },
    "Fuses IMU and GNSS data to produce ego vehicle state: world-frame position, heading angle, and longitudinal speed.");
  n("sensor-proximity", "Proximity Estimator", "sensor", 8,
    { method: "Min L2 distance", thresholds: "critical<4m, warning<20m", output: "nearestObjectDist" },
    "Computes minimum Euclidean distance from ego vehicle to all detected objects. Feeds proximity signal into observation vector and incident detection.");

  e("env-waymo", "sensor-lidar", "raw_pointcloud", "rgba(0,201,219,0.30)");
  e("env-waymo", "sensor-bbox", "actor_detections", "rgba(0,201,219,0.30)");
  e("env-waymo", "sensor-ego", "ego_telemetry", "rgba(0,201,219,0.30)");
  e("sensor-bbox", "sensor-proximity", "object_positions", "rgba(0,201,219,0.25)");

  /* ---- Layer 3: Observation Space ---- */
  n("obs-vector", "Observation Vector", "observation", 13,
    { dimensions: 6, encoding: "flat concatenation", normalization: "none" },
    "6-dimensional observation vector: [frameIndex, egoX, egoY, egoSpeed, nearestObjectDist, scenarioId]. Composed from sensor outputs and fed to all policy networks.");
  n("obs-frame", "Frame Index t", "observation", 4,
    { range: "0\u2013199", type: "temporal" },
    "Discrete timestep index within the segment. Used for temporal context and trajectory phase estimation.");
  n("obs-ego-pos", "Ego Position (X, Y)", "observation", 4,
    { type: "spatial", frame: "world coordinates" },
    "World-frame ego position. Drives trajectory divergence computation and spatial reward terms.");
  n("obs-speed", "Ego Speed v", "observation", 4,
    { type: "kinematic", unit: "m/s", maxCap: 30 },
    "Longitudinal ego speed in m/s. Capped at 30 m/s. Key input for TTC estimation and action feasibility.");
  n("obs-dist", "Nearest Object d\u2098\u1d62\u2099", "observation", 4,
    { type: "proximity", unit: "meters", critical: "<4m" },
    "Minimum distance to any detected object. Primary driver of safety reward component and context-aware action weighting.");
  n("obs-scenario", "Scenario Context", "observation", 4,
    { type: "categorical", cardinality: 6 },
    "Categorical scenario identifier. Conditions the reward function and incident detection thresholds.");

  e("sensor-ego", "obs-ego-pos", "encode_position", "rgba(77,168,255,0.25)");
  e("sensor-ego", "obs-speed", "encode_speed", "rgba(77,168,255,0.25)");
  e("sensor-proximity", "obs-dist", "min_distance", "rgba(77,168,255,0.25)");
  e("sensor-lidar", "obs-frame", "frame_sync", "rgba(77,168,255,0.20)");
  e("env-waymo", "obs-scenario", "scenario_id", "rgba(77,168,255,0.20)");

  e("obs-frame", "obs-vector", "compose", "rgba(77,168,255,0.30)");
  e("obs-ego-pos", "obs-vector", "compose", "rgba(77,168,255,0.30)");
  e("obs-speed", "obs-vector", "compose", "rgba(77,168,255,0.30)");
  e("obs-dist", "obs-vector", "compose", "rgba(77,168,255,0.30)");
  e("obs-scenario", "obs-vector", "compose", "rgba(77,168,255,0.30)");

  /* ---- Layer 4: Policy Network ---- */
  n("policy-planner", "Planner Policy \u03C0_p", "policy", 13,
    { role: "Trajectory candidate selector", input: "obs_vector \u2208 \u211D\u2076", output: "trajectory_index \u2208 {0,1,2}", variants: 3 },
    "Primary decision network. Evaluates 3 trajectory candidates (conservative, moderate, aggressive) and selects one based on the current policy variant. Outputs a trajectory index for the observer to validate.");
  n("policy-observer", "Observer Policy \u03C0_o", "policy", 13,
    { role: "Safety-aware trajectory evaluator", input: "obs + planner_choice", output: "final_trajectory", variants: 2 },
    "Secondary safety-check network. Receives the planner\u2019s trajectory choice and may override it based on safety heuristics. Implements a hierarchical decision structure where observer acts as a safety filter.");
  n("policy-action-selector", "Action Selector", "policy", 11,
    { role: "Trajectory \u2192 discrete action", actionSpace: 9, method: "proximity-weighted sampling" },
    "Maps the selected trajectory to one of 9 discrete ego actions. Uses context-aware proximity weighting: closer objects bias toward defensive actions (brake, yield); clear road biases toward efficient actions (accelerate, keep_lane).");

  n("pv-planner-worst", "Worst Trajectory", "policy_variant", 5,
    { parent: "planner", strategy: "argmin(score)", purpose: "Adversarial testing" },
    "Selects the lowest-scoring trajectory candidate. Used for adversarial testing to explore worst-case ego behavior and stress-test safety systems.");
  n("pv-planner-best", "Best Trajectory", "policy_variant", 5,
    { parent: "planner", strategy: "argmax(score)", purpose: "Optimal baseline" },
    "Selects the highest-scoring trajectory candidate. Produces conservative, safety-optimal behavior. Serves as the ground-truth baseline policy.");
  n("pv-planner-random", "Random Trajectory", "policy_variant", 5,
    { parent: "planner", strategy: "uniform \u223C U(0,2)", purpose: "Exploration" },
    "Uniform random trajectory selection for stochastic exploration. Ensures the counterfactual engine explores the full action space without policy bias.");
  n("pv-observer-best", "Observer Best", "policy_variant", 5,
    { parent: "observer", strategy: "always select safest", purpose: "Safety override" },
    "Always overrides the planner with the safest trajectory. Acts as a hard safety constraint, ensuring no dangerous actions reach execution.");
  n("pv-observer-heuristic", "Heuristic 80/20", "policy_variant", 5,
    { parent: "observer", strategy: "P(best)=0.8, P(2nd)=0.2", purpose: "Realistic decision noise" },
    "Probabilistic observer: 80% chance of selecting best trajectory, 20% chance of second-best. Models realistic human-like decision uncertainty.");

  e("obs-vector", "policy-planner", "input_obs", "rgba(167,139,250,0.35)");
  e("obs-vector", "policy-observer", "input_obs", "rgba(167,139,250,0.35)");
  e("obs-vector", "policy-action-selector", "context", "rgba(167,139,250,0.25)");

  e("policy-planner", "pv-planner-worst", "worst_select", "rgba(192,132,252,0.25)");
  e("policy-planner", "pv-planner-best", "best_select", "rgba(192,132,252,0.25)");
  e("policy-planner", "pv-planner-random", "random_select", "rgba(192,132,252,0.25)");
  e("policy-observer", "pv-observer-best", "best_eval", "rgba(192,132,252,0.25)");
  e("policy-observer", "pv-observer-heuristic", "heuristic_eval", "rgba(192,132,252,0.25)");

  e("pv-planner-worst", "policy-action-selector", "trajectory", "rgba(192,132,252,0.20)");
  e("pv-planner-best", "policy-action-selector", "trajectory", "rgba(192,132,252,0.20)");
  e("pv-planner-random", "policy-action-selector", "trajectory", "rgba(192,132,252,0.20)");
  e("pv-observer-best", "policy-action-selector", "override", "rgba(192,132,252,0.20)");
  e("pv-observer-heuristic", "policy-action-selector", "override", "rgba(192,132,252,0.20)");

  /* ---- Layer 5: Action Space ---- */
  const actions: [string, string, string, Record<string, string | number>][] = [
    ["action-keep_lane", "Keep Lane", "No speed/heading change. Maintain current trajectory.", { group: "longitudinal", speedDelta: 0, lateralRate: 0 }],
    ["action-brake_mild", "Brake Mild", "Gentle deceleration at -1.5 m/s\u00b2. Standard slowing.", { group: "longitudinal", speedDelta: -1.5, lateralRate: 0 }],
    ["action-brake_hard", "Brake Hard", "Emergency deceleration at -4.0 m/s\u00b2. Triggers intervention counter.", { group: "longitudinal", speedDelta: -4.0, triggersIntervention: 1 }],
    ["action-accelerate", "Accelerate", "Speed increase +2.0 m/s\u00b2, capped at 30 m/s.", { group: "longitudinal", speedDelta: 2.0, maxSpeed: 30 }],
    ["action-merge_left", "Merge Left", "Full lane change left at +1.85 m/s lateral rate.", { group: "lateral", lateralRate: 1.85 }],
    ["action-merge_right", "Merge Right", "Full lane change right at -1.85 m/s lateral rate.", { group: "lateral", lateralRate: -1.85 }],
    ["action-yield", "Yield", "Defensive deceleration -2.0 m/s\u00b2 and yield right-of-way.", { group: "defensive", speedDelta: -2.0 }],
    ["action-nudge_left", "Nudge Left", "Slight lateral shift left at +0.5 m/s. Evasive micro-maneuver.", { group: "lateral", lateralRate: 0.5 }],
    ["action-nudge_right", "Nudge Right", "Slight lateral shift right at -0.5 m/s. Evasive micro-maneuver.", { group: "lateral", lateralRate: -0.5 }],
  ];
  for (const [id, label, desc, details] of actions) {
    n(id, label, "action", id === "action-brake_hard" ? 6 : 5, details, desc);
    e("policy-action-selector", id, "select", "rgba(0,232,157,0.30)");
  }

  /* ---- Layer 6: State Transition ---- */
  n("state-transition", "State Transition s\u2032 = f(s, a)", "state", 11,
    { model: "Kinematic bicycle", dt: 0.1, integration: "Euler forward" },
    "Applies the selected action to the ego state using a kinematic bicycle model with dt=0.1s. Updates position via x\u2032 = x + v\u00B7cos(\u03B8)\u00B7dt, y\u2032 = y + v\u00B7sin(\u03B8)\u00B7dt, and speed via action-specific acceleration.");
  n("state-feedback", "Reward \u2192 Policy Feedback", "state", 9,
    { loop: "TD(0) update", signal: "r(s,a,s\u2032)" },
    "Feeds the scalar reward signal back to the policy networks. Enables temporal-difference learning: the reward from state transition informs future action selection, closing the RL loop.");

  // Actions -> state transition
  for (const [id] of actions) {
    e(id, "state-transition", "apply_action", "rgba(244,114,182,0.25)");
  }
  // Feedback loop: state -> environment (THE RL LOOP)
  e("state-transition", "env-waymo", "next_state", "rgba(244,114,182,0.35)");

  /* ---- Layer 7: Reward System ---- */
  n("reward-safety", "Safety Reward R_s", "reward", 8,
    { trigger: "d_min < 5m", range: "-0.2 to 1.0", weight: "dominant near objects" },
    "Proximity-based reward component. When nearest object < 5m, strongly rewards defensive actions (brake, yield) with r \u2208 [0.7, 1.0] and penalizes passive actions with r \u2208 [-0.2, 0.1]. Dominant when close to obstacles.");
  n("reward-efficiency", "Efficiency Reward R_e", "reward", 8,
    { trigger: "d_min > 15m", range: "0.3 to 0.9", weight: "dominant when clear" },
    "Speed-maintenance reward component. When road is clear (d > 15m), rewards flow-efficient actions (accelerate, keep_lane) with r \u2208 [0.5, 0.9]. Ensures the ego vehicle doesn\u2019t unnecessarily slow down.");
  n("reward-exploration", "Exploration Noise \u03B5", "reward", 6,
    { distribution: "U(\u00B10.075)", purpose: "Prevent policy collapse" },
    "Small uniform noise \u03B5 ~ U(-0.075, +0.075) added to every reward signal. Prevents deterministic policy collapse and encourages diverse counterfactual trajectories across branches.");
  n("reward-aggregator", "Reward Aggregator R(s,a)", "reward", 11,
    { method: "clamp(R_s + R_e + \u03B5, -1, 1)", output: "scalar \u2208 [-1, +1]" },
    "Combines safety reward, efficiency reward, and exploration noise via weighted sum with hard clipping to [-1, +1]. Final scalar reward signal driving the RL loop and all downstream metrics.");

  e("state-transition", "reward-safety", "proximity_eval", "rgba(251,191,36,0.30)");
  e("state-transition", "reward-efficiency", "speed_eval", "rgba(251,191,36,0.30)");
  e("reward-safety", "reward-aggregator", "weighted_sum", "rgba(251,191,36,0.35)");
  e("reward-efficiency", "reward-aggregator", "weighted_sum", "rgba(251,191,36,0.35)");
  e("reward-exploration", "reward-aggregator", "add_noise", "rgba(251,191,36,0.25)");

  // Feedback: reward -> policy
  e("reward-aggregator", "state-feedback", "reward_signal", "rgba(244,114,182,0.30)");
  e("state-feedback", "policy-planner", "policy_update", "rgba(167,139,250,0.30)");
  e("state-feedback", "policy-observer", "policy_update", "rgba(167,139,250,0.30)");

  /* ---- Layer 8: Metrics ---- */
  n("metric-cumulative", "Cumulative Reward \u03A3r", "metric", 6,
    { computation: "R_total = \u03A3 r_t", unit: "scalar" },
    "Running sum of all step rewards across the run. Primary performance metric for comparing counterfactual branches. Higher is better.");
  n("metric-avg", "Average Reward \u03BC_r", "metric", 5,
    { computation: "\u03BC = R_total / T", unit: "reward/step" },
    "Mean reward per step. Normalizes for runs of different lengths. Smoothed indicator of per-decision quality.");
  n("metric-ttc", "Min Time-to-Collision", "metric", 7,
    { computation: "min(d / v) over run", unit: "seconds", warning: "<3s" },
    "Minimum time-to-collision across the entire run. Computed as min(d_nearest / v_ego) at each step. Values < 3s trigger warnings. The core safety metric.");
  n("metric-interventions", "Intervention Count", "metric", 6,
    { computation: "\u03A3(a_t = brake_hard)", unit: "count" },
    "Number of brake_hard actions taken during the run. Each counts as a safety intervention. High counts indicate the ego frequently needed emergency responses.");
  n("metric-delta", "Delta vs Main \u0394R", "metric", 6,
    { computation: "R_branch - R_main", unit: "scalar" },
    "Reward difference between this counterfactual branch and the ground-truth main simulation. Positive = outperformed main, negative = underperformed.");

  e("reward-aggregator", "metric-cumulative", "accumulate", "rgba(110,231,183,0.30)");
  e("reward-aggregator", "metric-avg", "average", "rgba(110,231,183,0.30)");
  e("state-transition", "metric-ttc", "compute_ttc", "rgba(110,231,183,0.25)");
  e("action-brake_hard", "metric-interventions", "count_intervention", "rgba(110,231,183,0.25)");

  /* ---- Layer 9: Counterfactual Branching ---- */
  n("branch-engine", "Counterfactual Engine", "branching", 12,
    { maxActive: 3, spawnCount: 3, spawnInterval: "10s", advanceInterval: "3s" },
    "Orchestrates parallel simulation branches. Every 10s, spawns 3 new counterfactual runs with unique PRNG seeds. Each branch diverges from the main trajectory, running 20 steps before finishing. Enables what-if analysis of alternative ego decisions.");
  n("branch-prng", "PRNG Seed Generator", "branching", 7,
    { algorithm: "mulberry32", formula: "baseSeed + i \u00D7 7919", output: "deterministic seed" },
    "Generates deterministic pseudo-random seeds for each counterfactual branch using mulberry32 PRNG. Seed formula ensures reproducible yet diverse action sequences across branches.");
  n("branch-pool", "Active Branch Pool", "branching", 8,
    { maxConcurrent: 3, stepsPerRun: 20, lifecycle: "running \u2192 finished \u2192 replaced" },
    "Manages up to 3 concurrent running branches. Each runs for 20 steps (60s at 3s advance interval), then transitions to finished. Finished runs are replaced by new spawns, maintaining a continuous exploration of the action space.");
  n("branch-comparator", "Branch Comparator", "branching", 7,
    { input: "finished runs", output: "ranked \u0394R values" },
    "Compares all finished counterfactual branches against the main simulation. Computes \u0394R = R_branch - R_main and ranks outcomes. Powers the analytics dashboard\u2019s run comparison table.");

  e("branch-engine", "branch-prng", "generate_seed", "rgba(255,158,0,0.30)");
  e("branch-prng", "branch-pool", "seed_branch", "rgba(255,158,0,0.30)");
  e("branch-pool", "branch-comparator", "finished_runs", "rgba(255,158,0,0.25)");
  e("branch-comparator", "metric-delta", "compute_delta", "rgba(110,231,183,0.25)");
  e("branch-pool", "state-transition", "step_branch", "rgba(244,114,182,0.20)");
  e("policy-action-selector", "branch-engine", "fork_action", "rgba(255,158,0,0.25)");

  return { nodes, links };
}

/* ---------- Dynamic session layer ---------- */

function addSessionNodes(
  graph: GraphData,
  scenarioId: ScenarioId,
): GraphData {
  const nodes = [...graph.nodes];
  const links = [...graph.links];

  const n = (id: string, label: string, type: RLNodeType, val: number, details: Record<string, string | number>, description: string) => {
    nodes.push({ id, label, type, val, color: NODE_COLORS[type], details, description });
  };
  const e = (source: string, target: string, label: string, color: string) => {
    links.push({ source, target, label, color });
  };

  const info = SCENARIO_INFO[scenarioId];
  const metrics = VARIANT_METRICS[scenarioId];
  const variants: SceneVariant[] = ["ground_truth", "avoid_left", "avoid_right", "emergency_brake"];

  // Active scenario node — glowing
  n("session-scenario", `Active: ${info.label}`, "environment", 20,
    { severity: info.severity, scenarioId, status: "ACTIVE" },
    `Currently loaded scenario: ${info.label}. Severity: ${info.severity}. This is the driving scene being analyzed by the adversarial pipeline.`);
  e("env-waymo", "session-scenario", "active_scenario", "rgba(0,232,157,0.5)");

  // Incident node
  if (info.incident) {
    n("session-incident", `Incident: ${info.label}`, "state", 12,
      { startTime: info.incident.startTime, peakTime: info.incident.peakTime, endTime: info.incident.endTime },
      `Detected incident in ${info.label} scenario: peak danger at t=${info.incident.peakTime}s, window ${info.incident.startTime}s–${info.incident.endTime}s.`);
    e("session-scenario", "session-incident", "incident_detected", "rgba(239,68,68,0.5)");
  }

  // Counterfactual response nodes
  const variantColors: Record<SceneVariant, string> = {
    ground_truth: "#4ECDC4",
    avoid_left: "#FFD93D",
    avoid_right: "#FF6B6B",
    emergency_brake: "#7B68EE",
  };

  for (const v of variants) {
    const vInfo = VARIANT_INFO[v];
    const vMetrics = metrics[v];
    const nodeId = `session-cf-${v}`;
    const isOptimal = vMetrics.status === "optimal";

    n(nodeId, vInfo.label, isOptimal ? "action" : "policy_variant", isOptimal ? 10 : 6,
      { reward: vMetrics.reward, safety: vMetrics.safety, ttc: vMetrics.ttc === Infinity ? 999 : vMetrics.ttc, status: vMetrics.status },
      `Counterfactual: ${vInfo.label}${vInfo.description ? ` — ${vInfo.description}` : ""}. Reward: ${vMetrics.reward > 0 ? "+" : ""}${vMetrics.reward.toFixed(2)}, Safety: ${(vMetrics.safety * 100).toFixed(0)}%, TTC: ${vMetrics.ttc === Infinity ? "∞" : vMetrics.ttc.toFixed(1) + "s"}. Status: ${vMetrics.status}.`);

    const linkColor = isOptimal ? "rgba(0,232,157,0.5)" : vMetrics.status === "dangerous" ? "rgba(239,68,68,0.4)" : "rgba(255,217,61,0.3)";
    e(info.incident ? "session-incident" : "session-scenario", nodeId, "counterfactual", linkColor);
  }

  // GRPO learning node — what the model should learn from this scenario
  const optimal = variants.find(v => metrics[v].status === "optimal") ?? "ground_truth";
  const optLabel = VARIANT_INFO[optimal].label;
  const dangerous = variants.filter(v => metrics[v].status === "dangerous");
  const dangerLabels = dangerous.map(v => VARIANT_INFO[v].label).join(", ");

  n("session-grpo", "GRPO Policy Update", "reward", 14,
    { learningSignal: `prefer ${optLabel}`, penalize: dangerLabels || "none" },
    `GRPO learning signal for ${info.label}: reinforce "${optLabel}" trajectories (highest reward/safety), penalize ${dangerLabels || "no"} dangerous responses. Human ranking refines this signal beyond automated metrics.`);

  e(`session-cf-${optimal}`, "session-grpo", "reinforce", "rgba(0,232,157,0.6)");
  for (const d of dangerous) {
    e(`session-cf-${d}`, "session-grpo", "penalize", "rgba(239,68,68,0.4)");
  }
  e("session-grpo", "policy-planner", "update_weights", "rgba(167,139,250,0.5)");

  return { nodes, links };
}

/* ---------- Chat types & AI integration ---------- */

interface ChatMessage {
  id: number;
  role: "user" | "assistant" | "status";
  content: string;
  nodeIds?: string[];
}

const CHAT_SUGGESTIONS = [
  "How does the reward function work?",
  "What happens when an object is very close?",
  "Explain the counterfactual branching",
  "How are policies structured?",
  "What metrics are tracked?",
  "How does the RL loop close?",
];

function buildSystemPrompt(nodes: GraphNode[]): string {
  const nodeList = nodes.map((n) =>
    `- ID: "${n.id}" | Label: "${n.label}" | Type: ${n.type} | Description: ${n.description || "N/A"}`
  ).join("\n");

  return `You are an expert AI assistant for Overflow, an autonomous driving reinforcement learning platform. You help users understand the RL architecture by answering questions and directing them to relevant nodes in a 3D knowledge graph.

The graph contains ${nodes.length} nodes representing the RL pipeline:

NODES:
${nodeList}

PIPELINE FLOW:
Environment (Waymo scenes + scenarios) → Sensors (LiDAR, BBox3D, Ego State, Proximity) → Observation Vector (6D: frame, pos, speed, dist, scenario) → Policy Networks (Planner π_p, Observer π_o, Action Selector) → 9 Discrete Actions → State Transition s'=f(s,a) → Reward (Safety + Efficiency + Noise → Aggregator) → Metrics (Cumulative, Avg, TTC, Interventions, Delta) + Counterfactual Branching (Engine, PRNG, Pool, Comparator). Feedback loops: state→environment (next_state), reward→policy (policy_update).

INSTRUCTIONS:
1. Answer the user's question clearly and concisely (2-4 sentences max).
2. Identify the most relevant node(s) to navigate to.
3. Return ONLY valid JSON (no markdown, no code blocks):
{
  "answer": "Your concise explanation here",
  "nodeIds": ["node-id-1", "node-id-2"],
  "primaryNodeId": "node-id-1"
}

RULES:
- primaryNodeId MUST be one of the nodeIds and must be a valid node ID from the list above
- nodeIds should contain 1-4 most relevant nodes
- Keep answers focused and technical
- If the question is about a concept that spans multiple nodes, pick the most central one as primary`;
}

function mockGraphAnswer(question: string): { answer: string; nodeIds: string[]; primaryNodeId: string } {
  const q = question.toLowerCase();
  if (q.includes("reward")) return {
    answer: "The reward function combines a proximity-based safety reward R_s (dominant when objects < 5m), an efficiency reward R_e (dominant when road is clear), and exploration noise ε. These are summed and clamped to [-1, +1] by the Reward Aggregator. The safety component strongly rewards braking/yielding near obstacles, while efficiency rewards maintaining speed in clear conditions.",
    nodeIds: ["reward-aggregator", "reward-safety", "reward-efficiency", "reward-exploration"],
    primaryNodeId: "reward-aggregator",
  };
  if (q.includes("counterfactual") || q.includes("branch")) return {
    answer: "The Counterfactual Engine spawns parallel simulation branches every 10s, each with a unique PRNG seed. Up to 3 branches run concurrently for 20 steps each. The Branch Comparator then ranks them by ΔR (reward delta vs. ground truth). This enables 'what-if' analysis: each branch explores a different ego decision from the same starting state.",
    nodeIds: ["branch-engine", "branch-pool", "branch-comparator", "branch-prng"],
    primaryNodeId: "branch-engine",
  };
  if (q.includes("policy") || q.includes("planner")) return {
    answer: "The policy architecture has two stages: the Planner Policy π_p evaluates 3 trajectory candidates (conservative, moderate, aggressive) and the Observer Policy π_o acts as a safety filter that can override the planner. The Action Selector then maps the chosen trajectory to one of 9 discrete actions using proximity-weighted sampling.",
    nodeIds: ["policy-planner", "policy-observer", "policy-action-selector"],
    primaryNodeId: "policy-planner",
  };
  if (q.includes("action") || q.includes("brake") || q.includes("swerve")) return {
    answer: "The action space has 9 discrete actions: keep_lane, brake_mild (-1.5 m/s²), brake_hard (-4.0 m/s²), accelerate (+2.0 m/s²), merge_left/right (±1.85 m/s lateral), yield (-2.0 m/s²), and nudge_left/right (±0.5 m/s). Action selection is context-aware: proximity to objects biases toward defensive actions.",
    nodeIds: ["action-brake_hard", "action-merge_left", "action-keep_lane", "policy-action-selector"],
    primaryNodeId: "policy-action-selector",
  };
  if (q.includes("lidar") || q.includes("sensor") || q.includes("perception")) return {
    answer: "The perception stack uses a 64-beam LiDAR scanner (2650 columns, 75m range, 360° FOV) generating ~150K points per frame. A 3D bounding box detector classifies objects as vehicle/pedestrian/cyclist/sign with position, dimensions, heading, and speed. The Proximity Estimator computes minimum distance to all detected objects.",
    nodeIds: ["sensor-lidar", "sensor-bbox", "sensor-proximity", "sensor-ego"],
    primaryNodeId: "sensor-lidar",
  };
  if (q.includes("grpo") || q.includes("train") || q.includes("learn")) return {
    answer: "GRPO (Group Relative Policy Optimization) works by generating K trajectory candidates per scene, scoring them with the reward model, computing group-relative advantages, and updating the policy toward higher-scoring trajectories. Human preference rankings from the Rank page feed the reward model, which then guides GRPO to produce better driving decisions.",
    nodeIds: ["session-grpo", "reward-aggregator", "policy-planner", "state-feedback"],
    primaryNodeId: "session-grpo",
  };
  if (q.includes("ttc") || q.includes("metric") || q.includes("safety")) return {
    answer: "Key metrics include: Min TTC (minimum time-to-collision, warning < 3s), Cumulative Reward (total reward across the run), Average Reward (per-step quality), Intervention Count (number of emergency brakes), and Delta vs Main (reward difference between counterfactual and ground truth).",
    nodeIds: ["metric-ttc", "metric-cumulative", "metric-avg", "metric-interventions"],
    primaryNodeId: "metric-ttc",
  };
  if (q.includes("loop") || q.includes("rl") || q.includes("close")) return {
    answer: "The RL loop closes through state transitions: actions modify ego state via a kinematic bicycle model (dt=0.1s), the new state feeds back to the environment as the next observation, and the reward signal from the transition updates the policy networks. This creates a continuous learning cycle: observe → decide → act → receive reward → update policy.",
    nodeIds: ["state-transition", "state-feedback", "env-waymo", "reward-aggregator"],
    primaryNodeId: "state-transition",
  };
  // Default
  return {
    answer: "The Overflow RL architecture flows: Environment (Waymo scenes) → Sensors (LiDAR, BBox3D, Ego State) → Observation Vector → Policy Networks (Planner + Observer) → 9 Actions → State Transition → Reward (Safety + Efficiency) → Metrics + Counterfactual Branching. The feedback loop from reward to policy enables continuous learning. Click any node to explore details.",
    nodeIds: ["env-waymo", "policy-planner", "reward-aggregator", "branch-engine"],
    primaryNodeId: "env-waymo",
  };
}

async function queryGraphAI(
  question: string,
  systemPrompt: string,
): Promise<{ answer: string; nodeIds: string[]; primaryNodeId: string } | { error: string }> {
  const key = getApiKey();
  if (!key) return { error: "No API key. Click the key icon to set your OpenAI key." };

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.3,
        max_tokens: 500,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: question },
        ],
      }),
    });

    if (!res.ok) {
      // Fall back to mock response on API errors
      return mockGraphAnswer(question);
    }

    const data = await res.json();
    let content: string = data.choices?.[0]?.message?.content ?? "";
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) content = jsonMatch[1].trim();

    const parsed = JSON.parse(content);
    if (!parsed.answer || !parsed.primaryNodeId) return mockGraphAnswer(question);
    return parsed;
  } catch {
    // Fall back to mock response on network errors
    return mockGraphAnswer(question);
  }
}

/* ---------- Custom Three.js node creator ---------- */

function createTextTexture(text: string, color: string, bgAlpha = 0.5): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  canvas.width = 256;
  canvas.height = 64;
  ctx.clearRect(0, 0, 256, 64);

  ctx.font = "bold 22px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  const tw = ctx.measureText(text).width;
  const pw = Math.min(tw + 24, 250);
  const ph = 28;
  const px = 128 - pw / 2;
  const py = 18;

  ctx.fillStyle = `rgba(10,13,22,${bgAlpha})`;
  ctx.beginPath();
  ctx.roundRect(px, py, pw, ph, 6);
  ctx.fill();
  ctx.strokeStyle = color + "40";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = color;
  ctx.fillText(text, 128, 38);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function createNodeObject(node: GraphNode): THREE.Object3D {
  const group = new THREE.Group();
  const size = Math.cbrt(node.val) * 1.6;
  const color = new THREE.Color(node.color);

  // Select geometry based on node type
  let geo: THREE.BufferGeometry;
  switch (node.type) {
    case "sensor": geo = OCTA_GEO; break;
    case "policy":
    case "policy_variant": geo = ICO_GEO; break;
    case "action": geo = CONE_GEO; break;
    case "metric": geo = BOX_GEO; break;
    case "branching": geo = DODECA_GEO; break;
    case "state": geo = node.id === "state-feedback" ? TORUS_STATE_GEO : TORUS_KNOT_GEO; break;
    case "reward": geo = node.id === "reward-aggregator" ? TORUS_KNOT_GEO : SPHERE_GEO; break;
    default: geo = SPHERE_GEO; break;
  }

  // Core mesh
  const coreMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 });
  const core = new THREE.Mesh(geo, coreMat);
  core.scale.setScalar(size);
  group.add(core);

  // Inner bright point
  const pointMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 });
  const point = new THREE.Mesh(SPHERE_GEO, pointMat);
  point.scale.setScalar(size * 0.25);
  group.add(point);

  // Outer glow
  const glowMat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.06, depthWrite: false, side: THREE.BackSide,
  });
  const glow = new THREE.Mesh(GLOW_GEO, glowMat);
  glow.scale.setScalar(size * 3);
  group.add(glow);

  // Second glow layer
  const glow2Mat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.03, depthWrite: false, side: THREE.BackSide,
  });
  const glow2 = new THREE.Mesh(GLOW_GEO, glow2Mat);
  glow2.scale.setScalar(size * 5);
  group.add(glow2);

  // Orbital rings for key nodes
  const hasRings = node.type === "environment" || node.type === "policy" || node.type === "branching"
    || node.id === "obs-vector" || node.id === "reward-aggregator" || node.id === "state-transition";
  if (hasRings) {
    const ringMat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.3, side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(RING_GEO, ringMat);
    ring.scale.setScalar(size * 2);
    ring.rotation.x = Math.PI / 2;
    group.add(ring);

    const ring2Mat = ringMat.clone();
    ring2Mat.opacity = 0.15;
    const ring2 = new THREE.Mesh(RING_GEO, ring2Mat);
    ring2.scale.setScalar(size * 2.5);
    ring2.rotation.x = Math.PI / 3;
    ring2.rotation.z = Math.PI / 4;
    group.add(ring2);

    // Third ring for the root environment node
    if (node.id === "env-waymo") {
      const ring3Mat = ringMat.clone();
      ring3Mat.opacity = 0.1;
      const ring3 = new THREE.Mesh(RING_GEO, ring3Mat);
      ring3.scale.setScalar(size * 3);
      ring3.rotation.x = Math.PI / 6;
      ring3.rotation.y = Math.PI / 3;
      group.add(ring3);
    }
  }

  // Text label sprite
  const labelText = node.label.length > 24 ? node.label.slice(0, 22).toUpperCase() + "\u2026" : node.label.toUpperCase();
  const texture = createTextTexture(labelText, node.color);
  const spriteMat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(spriteMat);
  const labelScale = Math.max(size * 3.5, 10);
  sprite.scale.set(labelScale, labelScale * 0.25, 1);
  sprite.position.set(0, -(size + 2.5), 0);
  group.add(sprite);

  return group;
}

/* ---------- Component ---------- */

export default function GraphPage() {
  const navigate = useNavigate();
  const actions = useStore((s) => s.actions);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const graphRef = useRef<any>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  // Chat state
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [apiKey, setLocalApiKey] = useState(getApiKey());
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);
  const chatIdCounter = useRef(0);

  useEffect(() => {
    const measure = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setDimensions({ width: rect.width, height: rect.height });
      }
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const scenarioId = useStore((s) => s.scenarioId);
  const graphData = useMemo(() => {
    const base = buildRLArchitectureGraph();
    return addSessionNodes(base, scenarioId);
  }, [scenarioId]);
  const systemPrompt = useMemo(() => buildSystemPrompt(graphData.nodes), [graphData]);

  // Set initial camera closer after graph settles
  useEffect(() => {
    const timer = setTimeout(() => {
      if (graphRef.current) {
        graphRef.current.cameraPosition({ x: 0, y: 0, z: 180 }, { x: 0, y: 0, z: 0 }, 0);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, []);

  // Auto-scroll chat
  useEffect(() => {
    chatScrollRef.current?.scrollTo({ top: chatScrollRef.current.scrollHeight, behavior: "smooth" });
  }, [chatMessages]);

  // Focus input when chat opens
  useEffect(() => {
    if (chatOpen) setTimeout(() => chatInputRef.current?.focus(), 100);
  }, [chatOpen]);

  const navigateToNode = useCallback((nodeId: string) => {
    // Find the node in the force graph's internal data (which has x, y, z)
    const fg = graphRef.current;
    if (!fg) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fgNode = graphData.nodes.find((n: any) => n.id === nodeId) as any;
    if (!fgNode || fgNode.x === undefined) return;

    const distance = 60;
    const pos = {
      x: fgNode.x + distance * Math.sin(Math.PI / 6),
      y: fgNode.y + distance * 0.3,
      z: fgNode.z + distance * Math.cos(Math.PI / 6),
    };
    fg.cameraPosition(pos, { x: fgNode.x, y: fgNode.y, z: fgNode.z }, 1500);

    // Select the node in the inspector
    const staticNode = graphData.nodes.find((n) => n.id === nodeId);
    if (staticNode) setSelectedNode(staticNode);
  }, [graphData]);

  const handleChatSubmit = useCallback(async () => {
    const text = chatInput.trim();
    if (!text || chatLoading) return;

    setChatInput("");
    const userMsgId = ++chatIdCounter.current;
    setChatMessages((prev) => [...prev, { id: userMsgId, role: "user", content: text }]);
    setChatLoading(true);

    const statusId = ++chatIdCounter.current;
    setChatMessages((prev) => [...prev, { id: statusId, role: "status", content: "Thinking..." }]);

    const result = await queryGraphAI(text, systemPrompt);

    // Remove status
    setChatMessages((prev) => prev.filter((m) => m.id !== statusId));

    if ("error" in result) {
      const errId = ++chatIdCounter.current;
      setChatMessages((prev) => [...prev, { id: errId, role: "assistant", content: result.error }]);
    } else {
      const msgId = ++chatIdCounter.current;
      setChatMessages((prev) => [...prev, {
        id: msgId,
        role: "assistant",
        content: result.answer,
        nodeIds: result.nodeIds,
      }]);
      // Navigate to primary node
      if (result.primaryNodeId) {
        navigateToNode(result.primaryNodeId);
      }
    }

    setChatLoading(false);
  }, [chatInput, chatLoading, systemPrompt, navigateToNode]);

  const handleChatKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleChatSubmit(); }
  }, [handleChatSubmit]);

  const saveKey = useCallback(() => {
    setApiKey(apiKey);
    setShowKeyInput(false);
  }, [apiKey]);

  const handleNodeClick = useCallback((node: object) => {
    setSelectedNode(node as GraphNode);
  }, []);

  const nodeThreeObject = useCallback((node: object) => {
    return createNodeObject(node as GraphNode);
  }, []);

  const stats = useMemo(() => {
    const typeCounts: Record<string, number> = {};
    graphData.nodes.forEach((n) => { typeCounts[n.type] = (typeCounts[n.type] || 0) + 1; });
    return typeCounts;
  }, [graphData]);

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden", position: "relative" }}>

      {/* 3D Graph area */}
      <div
        ref={containerRef}
        style={{ flex: 1, position: "relative", background: colors.bgDeep }}
      >
        <ForceGraph3D
          ref={graphRef}
          graphData={graphData}
          width={dimensions.width - (selectedNode ? 360 : 0)}
          height={dimensions.height}
          backgroundColor={"#060810"}
          nodeThreeObject={nodeThreeObject}
          nodeThreeObjectExtend={false}
          onNodeClick={handleNodeClick}
          linkColor={(link: object) => (link as GraphLink).color}
          linkWidth={1.5}
          linkOpacity={0.5}
          linkDirectionalParticles={3}
          linkDirectionalParticleWidth={2}
          linkDirectionalParticleSpeed={0.004}
          linkDirectionalParticleColor={(link: object) => (link as GraphLink).color}
          enableNodeDrag={true}
          enableNavigationControls={true}
          showNavInfo={false}
          warmupTicks={100}
          cooldownTime={5000}
          d3VelocityDecay={0.3}
        />

        {/* HUD corner brackets */}
        {[
          { top: 0, left: 0, borderTop: "2px solid rgba(0,232,157,0.2)", borderLeft: "2px solid rgba(0,232,157,0.2)" },
          { top: 0, right: 0, borderTop: "2px solid rgba(0,232,157,0.2)", borderRight: "2px solid rgba(0,232,157,0.2)" },
          { bottom: 0, left: 0, borderBottom: "2px solid rgba(0,232,157,0.2)", borderLeft: "2px solid rgba(0,232,157,0.2)" },
          { bottom: 0, right: 0, borderBottom: "2px solid rgba(0,232,157,0.2)", borderRight: "2px solid rgba(0,232,157,0.2)" },
        ].map((s, i) => (
          <div key={i} style={{ position: "absolute", width: 24, height: 24, pointerEvents: "none", ...s } as React.CSSProperties} />
        ))}

        {/* Header overlay */}
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0,
          padding: `${spacing.lg}px ${spacing.xl}px`,
          background: "linear-gradient(180deg, rgba(6,8,16,0.85) 0%, transparent 100%)",
          pointerEvents: "none",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 8,
              background: "rgba(0,232,157,0.08)",
              border: "1px solid rgba(0,232,157,0.2)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <Cpu size={16} color={colors.accent} />
            </div>
            <div>
              <h2 style={{
                ...typeScale.h2, margin: 0,
                background: "linear-gradient(135deg, #E8ECF4, #00E89D)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                letterSpacing: "-0.02em",
              }}>
                RL Architecture
              </h2>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 2 }}>
                <span style={{ ...typeScale.caption, color: colors.textDim, fontSize: 9 }}>
                  OVERFLOW REINFORCEMENT LEARNING PIPELINE
                </span>
                <span style={{
                  display: "inline-block", width: 5, height: 5, borderRadius: "50%",
                  background: colors.accent, boxShadow: `0 0 8px ${colors.accent}`,
                }} />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 2 }}>
                <span style={{ ...typeScale.caption, color: colors.textDim, fontSize: 9 }}>
                  {graphData.nodes.length} NODES
                </span>
                <span style={{ ...typeScale.caption, color: colors.textDim, fontSize: 9 }}>
                  {graphData.links.length} EDGES
                </span>
              </div>
            </div>
          </div>

          {/* Stats chips — clickable, navigate to primary node of each type */}
          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap", pointerEvents: "auto" }}>
            {Object.entries(stats).map(([type, count]) => {
              const nodeColor = NODE_COLORS[type as RLNodeType] || colors.border;
              return (
                <button
                  key={type}
                  onClick={() => navigateToNode(TYPE_PRIMARY_NODE[type as RLNodeType])}
                  style={{
                    display: "flex", alignItems: "center", gap: 4,
                    padding: "3px 8px", borderRadius: radius.pill,
                    background: "rgba(255,255,255,0.03)",
                    border: `1px solid ${nodeColor}20`,
                    cursor: "pointer",
                    transition: "all 0.2s ease",
                    fontFamily: fonts.mono,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = `${nodeColor}18`;
                    e.currentTarget.style.borderColor = `${nodeColor}50`;
                    e.currentTarget.style.boxShadow = `0 0 12px ${nodeColor}25`;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "rgba(255,255,255,0.03)";
                    e.currentTarget.style.borderColor = `${nodeColor}20`;
                    e.currentTarget.style.boxShadow = "none";
                  }}
                >
                  <div style={{
                    width: 6, height: 6, borderRadius: "50%",
                    background: nodeColor,
                    boxShadow: `0 0 4px ${nodeColor}60`,
                  }} />
                  <span style={{ fontSize: 8, color: colors.textDim }}>
                    {count} {NODE_LABELS[type as RLNodeType] || type}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Legend overlay */}
        <div style={{
          position: "absolute",
          bottom: spacing.xl,
          left: spacing.xl,
          background: "rgba(10,13,22,0.85)",
          backdropFilter: "blur(20px)",
          border: "1px solid rgba(0,232,157,0.08)",
          borderRadius: radius.lg,
          padding: `${spacing.sm}px ${spacing.md}px`,
          pointerEvents: "none",
        }}>
          <div style={{
            ...typeScale.caption, color: colors.textDim, fontSize: 8,
            marginBottom: 6, letterSpacing: "1.5px",
          }}>
            RL PIPELINE LAYERS
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: `4px ${spacing.md}px` }}>
            {Object.entries(NODE_COLORS).map(([type, color]) => (
              <div key={type} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <div style={{
                  width: 8, height: 8,
                  borderRadius: type === "metric" ? 2 : type === "state" ? "50%" : "50%",
                  background: color,
                  boxShadow: `0 0 6px ${color}50`,
                }} />
                <span style={{ fontSize: 9, fontFamily: fonts.mono, color: colors.textSecondary }}>
                  {NODE_LABELS[type as RLNodeType] || type}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom-right interaction hint */}
        <div style={{
          position: "absolute", bottom: spacing.xl, right: spacing.xl,
          display: "flex", gap: 8, pointerEvents: "none",
        }}>
          {["Scroll: Zoom", "Drag: Rotate", "Click: Inspect"].map((hint, i) => (
            <span key={i} style={{
              fontSize: 8, fontFamily: fonts.mono, color: colors.textMuted,
              padding: "3px 8px", borderRadius: radius.sm,
              background: "rgba(255,255,255,0.02)",
              border: "1px solid rgba(255,255,255,0.04)",
            }}>
              {hint}
            </span>
          ))}
        </div>

        {/* Chat toggle button */}
        {!chatOpen && (
          <button
            onClick={() => setChatOpen(true)}
            style={{
              position: "absolute", bottom: 80, left: spacing.xl, zIndex: 20,
              width: 42, height: 42, borderRadius: 12,
              border: "1px solid rgba(0,232,157,0.2)",
              background: "rgba(12,15,26,0.85)",
              backdropFilter: "blur(20px)",
              cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 0 20px rgba(0,232,157,0.15)",
              transition: "all 0.2s",
            }}
            title="Ask about the RL architecture"
          >
            <MessageCircle size={18} color={colors.accent} />
          </button>
        )}

        {/* Chat panel */}
        {chatOpen && (
          <div style={{
            position: "absolute", bottom: 80, left: spacing.xl, zIndex: 20,
            width: 380, maxHeight: "calc(100vh - 160px)",
            background: "rgba(12,15,26,0.92)",
            backdropFilter: "blur(24px)",
            border: "1px solid rgba(0,232,157,0.12)",
            borderRadius: 14,
            display: "flex", flexDirection: "column",
            overflow: "hidden",
            boxShadow: "0 8px 40px rgba(0,0,0,0.5), 0 0 30px rgba(0,232,157,0.08)",
            fontFamily: fonts.sans,
          }}>
            {/* Chat header */}
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "12px 16px",
              borderBottom: "1px solid rgba(255,255,255,0.06)",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <MessageCircle size={14} color={colors.accent} />
                <span style={{ fontSize: 13, fontWeight: 700, color: colors.textPrimary }}>
                  Graph Navigator
                </span>
                <span style={{ fontSize: 9, color: colors.textDim, fontFamily: fonts.mono }}>
                  GPT-4o-mini
                </span>
              </div>
              <div style={{ display: "flex", gap: 4 }}>
                <button
                  onClick={() => setShowKeyInput((v) => !v)}
                  style={{
                    border: "none", background: "rgba(255,255,255,0.05)",
                    borderRadius: 4, padding: "4px 6px", cursor: "pointer",
                    fontSize: 10, color: colors.textDim,
                  }}
                >
                  🔑
                </button>
                <button
                  onClick={() => setChatOpen(false)}
                  style={{
                    border: "none", background: "rgba(255,255,255,0.05)",
                    borderRadius: 4, padding: "4px 8px", cursor: "pointer",
                    fontSize: 12, color: colors.textDim, fontWeight: 700,
                  }}
                >
                  <X size={12} />
                </button>
              </div>
            </div>

            {/* API key input */}
            {showKeyInput && (
              <div style={{
                padding: "8px 12px",
                borderBottom: "1px solid rgba(255,255,255,0.06)",
                display: "flex", gap: 6, alignItems: "center",
              }}>
                <input
                  type="password"
                  placeholder="sk-... OpenAI API key"
                  value={apiKey}
                  onChange={(e) => setLocalApiKey(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") saveKey(); }}
                  style={{
                    flex: 1, padding: "6px 8px",
                    fontSize: 11, fontFamily: fonts.mono,
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: 4, color: colors.textPrimary, outline: "none",
                  }}
                />
                <button
                  onClick={saveKey}
                  style={{
                    padding: "6px 10px", fontSize: 10, fontWeight: 600,
                    background: colors.accentGlow, color: colors.accent,
                    border: "none", borderRadius: 4, cursor: "pointer",
                  }}
                >
                  Save
                </button>
              </div>
            )}

            {/* Messages */}
            <div
              ref={chatScrollRef}
              style={{
                flex: 1, overflowY: "auto", padding: 12,
                display: "flex", flexDirection: "column", gap: 8,
                minHeight: 180, maxHeight: 360,
              }}
            >
              {chatMessages.length === 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <p style={{ fontSize: 11, color: colors.textDim, margin: 0, lineHeight: 1.5 }}>
                    Ask anything about the RL architecture. I'll navigate you to the right node.
                  </p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
                    <span style={{
                      fontSize: 8, fontWeight: 700, color: colors.textDim,
                      textTransform: "uppercase", letterSpacing: "1px",
                    }}>
                      Try asking:
                    </span>
                    {CHAT_SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        onClick={() => { setChatInput(s); setTimeout(() => chatInputRef.current?.focus(), 50); }}
                        style={{
                          textAlign: "left", padding: "6px 10px", fontSize: 10,
                          color: colors.textSecondary,
                          background: "rgba(255,255,255,0.03)",
                          border: "1px solid rgba(255,255,255,0.05)",
                          borderRadius: 6, cursor: "pointer", fontFamily: fonts.sans,
                          transition: "all 0.15s", lineHeight: 1.4,
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = "rgba(0,232,157,0.06)";
                          e.currentTarget.style.borderColor = `${colors.accent}30`;
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = "rgba(255,255,255,0.03)";
                          e.currentTarget.style.borderColor = "rgba(255,255,255,0.05)";
                        }}
                      >
                        "{s}"
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {chatMessages.map((msg) => (
                <div key={msg.id} style={{
                  display: "flex",
                  justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
                }}>
                  <div style={{
                    maxWidth: "88%",
                    padding: "8px 12px",
                    borderRadius: msg.role === "user" ? "10px 10px 2px 10px" : "10px 10px 10px 2px",
                    background: msg.role === "user"
                      ? "rgba(0,232,157,0.12)"
                      : msg.role === "status"
                        ? "rgba(0,200,219,0.08)"
                        : "rgba(255,255,255,0.04)",
                    border: msg.role === "status" ? `1px solid ${colors.accentBlue}20` : "none",
                    fontSize: 11, lineHeight: 1.5,
                    color: msg.role === "status" ? colors.accentBlue : colors.textPrimary,
                    fontFamily: fonts.sans, whiteSpace: "pre-wrap",
                  }}>
                    {msg.content}
                    {/* Node navigation chips */}
                    {msg.nodeIds && msg.nodeIds.length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
                        {msg.nodeIds.map((nid) => {
                          const node = graphData.nodes.find((n) => n.id === nid);
                          if (!node) return null;
                          return (
                            <button
                              key={nid}
                              onClick={() => navigateToNode(nid)}
                              style={{
                                display: "inline-flex", alignItems: "center", gap: 4,
                                padding: "3px 8px", fontSize: 9, fontFamily: fonts.mono,
                                background: `${node.color}15`,
                                border: `1px solid ${node.color}30`,
                                borderRadius: radius.pill, cursor: "pointer",
                                color: node.color, transition: "all 0.15s",
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.background = `${node.color}25`;
                                e.currentTarget.style.borderColor = `${node.color}50`;
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.background = `${node.color}15`;
                                e.currentTarget.style.borderColor = `${node.color}30`;
                              }}
                            >
                              <div style={{
                                width: 5, height: 5, borderRadius: "50%",
                                background: node.color,
                                boxShadow: `0 0 4px ${node.color}60`,
                              }} />
                              {node.label.length > 20 ? node.label.slice(0, 18) + "\u2026" : node.label}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {chatLoading && (
                <div style={{ display: "flex", gap: 4, padding: "4px 0" }}>
                  {[0, 1, 2].map((i) => (
                    <div key={i} style={{
                      width: 6, height: 6, borderRadius: "50%",
                      background: colors.accent, opacity: 0.4,
                      animation: `graphChatDot 1.2s ease-in-out ${i * 0.2}s infinite`,
                    }} />
                  ))}
                </div>
              )}
            </div>

            {/* Input */}
            <div style={{
              padding: "10px 12px",
              borderTop: "1px solid rgba(255,255,255,0.06)",
              display: "flex", gap: 8,
            }}>
              <input
                ref={chatInputRef}
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={handleChatKeyDown}
                placeholder="Ask about the architecture..."
                disabled={chatLoading}
                style={{
                  flex: 1, padding: "8px 12px", fontSize: 12, fontFamily: fonts.sans,
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 8, color: colors.textPrimary, outline: "none",
                }}
              />
              <button
                onClick={handleChatSubmit}
                disabled={chatLoading || !chatInput.trim()}
                style={{
                  padding: "8px 12px", border: "none", borderRadius: 8, cursor: chatLoading ? "default" : "pointer",
                  background: chatLoading || !chatInput.trim()
                    ? "rgba(255,255,255,0.04)"
                    : `linear-gradient(135deg, ${colors.accent}, ${colors.accentBlue})`,
                  color: chatLoading || !chatInput.trim() ? colors.textDim : "#000",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  transition: "all 0.15s",
                }}
              >
                <Send size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Inspector panel */}
      {selectedNode && (
        <div style={{
          width: 360, flexShrink: 0,
          borderLeft: `1px solid ${colors.border}`,
          background: "linear-gradient(180deg, #0F1220 0%, #0A0D16 100%)",
          overflow: "auto",
          position: "relative",
        }}>
          {/* Accent top line */}
          <div style={{
            height: 2,
            background: `linear-gradient(90deg, ${selectedNode.color}, transparent)`,
            opacity: 0.5,
          }} />

          <div style={{ padding: spacing.lg }}>
            {/* Close button */}
            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "flex-start",
              marginBottom: spacing.lg,
            }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <Badge variant={nodeTypeToVariant(selectedNode.type)}>
                    {NODE_LABELS[selectedNode.type]}
                  </Badge>
                  <span style={{ fontSize: 16 }}>{NODE_ICONS[selectedNode.type]}</span>
                </div>
                <h3 style={{
                  ...typeScale.h2, color: colors.textPrimary, margin: 0,
                }}>
                  {selectedNode.label}
                </h3>
                <div style={{
                  ...typeScale.caption, color: colors.textDim, marginTop: 4, fontSize: 8,
                }}>
                  ID: {selectedNode.id}
                </div>
              </div>
              <button
                onClick={() => setSelectedNode(null)}
                style={{
                  cursor: "pointer", padding: 6, border: "1px solid rgba(255,255,255,0.06)",
                  background: "rgba(255,255,255,0.03)", borderRadius: 6,
                }}
              >
                <X size={14} color={colors.textDim} />
              </button>
            </div>

            {/* Description section */}
            {selectedNode.description && (
              <div style={{
                marginBottom: spacing.lg,
                padding: spacing.md,
                background: "rgba(255,255,255,0.02)",
                borderRadius: radius.md,
                border: `1px solid rgba(255,255,255,0.04)`,
              }}>
                <div style={{
                  ...typeScale.caption, color: colors.textDim, marginBottom: 8,
                  display: "flex", alignItems: "center", gap: 6, fontSize: 9,
                }}>
                  <Layers size={10} color={colors.textDim} />
                  DESCRIPTION
                </div>
                <p style={{
                  ...typeScale.body, color: colors.textSecondary, margin: 0,
                  lineHeight: 1.6, fontSize: 12,
                }}>
                  {selectedNode.description}
                </p>
              </div>
            )}

            {/* Properties section */}
            <div style={{
              marginBottom: spacing.lg,
              padding: spacing.md,
              background: "rgba(255,255,255,0.02)",
              borderRadius: radius.md,
              border: "1px solid rgba(255,255,255,0.04)",
            }}>
              <div style={{
                ...typeScale.caption, color: colors.textDim, marginBottom: 8,
                display: "flex", alignItems: "center", gap: 6, fontSize: 9,
              }}>
                <Activity size={10} color={colors.textDim} />
                PROPERTIES
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {selectedNode.details && Object.entries(selectedNode.details).map(([key, val]) => (
                  <div key={key} style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "6px 8px", borderRadius: radius.sm,
                    background: "rgba(255,255,255,0.02)",
                    borderLeft: `2px solid ${selectedNode.color}15`,
                  }}>
                    <span style={{ ...typeScale.small, color: colors.textDim }}>{key}</span>
                    <span style={{
                      ...typeScale.mono, color: colors.textSecondary, fontSize: 11,
                      background: "rgba(255,255,255,0.03)",
                      padding: "1px 6px", borderRadius: 3,
                      maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {typeof val === "number" ? (Number.isInteger(val) ? val : val.toFixed(3)) : String(val)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Connections section */}
            <div style={{
              padding: spacing.md,
              background: "rgba(255,255,255,0.02)",
              borderRadius: radius.md,
              border: "1px solid rgba(255,255,255,0.04)",
            }}>
              <div style={{
                ...typeScale.caption, color: colors.textDim, marginBottom: 8,
                display: "flex", alignItems: "center", gap: 6, fontSize: 9,
              }}>
                <GitBranch size={10} color={colors.textDim} />
                CONNECTIONS
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                {graphData.links
                  .filter((l) => l.source === selectedNode.id || l.target === selectedNode.id)
                  .slice(0, 15)
                  .map((l, i) => {
                    const otherId = l.source === selectedNode.id ? l.target : l.source;
                    const otherNode = graphData.nodes.find((n) => n.id === otherId);
                    return (
                      <div
                        key={i}
                        onClick={() => otherNode && setSelectedNode(otherNode)}
                        style={{
                          display: "flex", alignItems: "center", justifyContent: "space-between",
                          padding: "7px 8px", borderRadius: radius.sm, cursor: "pointer",
                          background: "rgba(255,255,255,0.02)",
                          border: "1px solid transparent",
                          transition: "all 0.15s ease",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = "rgba(255,255,255,0.04)";
                          e.currentTarget.style.borderColor = `${otherNode?.color || colors.border}30`;
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = "rgba(255,255,255,0.02)";
                          e.currentTarget.style.borderColor = "transparent";
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{
                            width: 7, height: 7, borderRadius: "50%",
                            background: otherNode?.color || colors.textDim,
                            boxShadow: `0 0 4px ${otherNode?.color || "transparent"}40`,
                          }} />
                          <div>
                            <span style={{ ...typeScale.small, color: colors.textSecondary, display: "block" }}>
                              {otherNode?.label || otherId}
                            </span>
                            {otherNode && (
                              <span style={{ fontSize: 8, color: colors.textMuted, fontFamily: fonts.mono }}>
                                {NODE_LABELS[otherNode.type]}
                              </span>
                            )}
                          </div>
                        </div>
                        <span style={{
                          ...typeScale.caption, color: colors.textMuted, fontSize: 7,
                          padding: "1px 5px", borderRadius: 3,
                          background: "rgba(255,255,255,0.03)",
                        }}>
                          {l.label.replace(/_/g, " ")}
                        </span>
                      </div>
                    );
                  })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* View Trained Policy button — bottom center */}
      <div style={{
        position: "absolute",
        bottom: 20,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 30,
        display: "flex",
        gap: 12,
      }}>
        <button
          onClick={async () => {
            try {
              const { loadScenario } = await import("../utils/scenarioLoader");
              const { generateTrajectoryMoments } = await import("../utils/trajectoryData");
              const sceneData = await loadScenario("final_model", "ground_truth");
              actions.setScenarioId("final_model");
              actions.setDataSource("scenario");
              actions.setSceneData(sceneData);
              actions.setTrajectoryMoments(generateTrajectoryMoments(sceneData));
            } catch { /* ignore */ }
            navigate("/sim");
          }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "12px 28px",
            borderRadius: 10,
            background: "linear-gradient(135deg, #00E89D, #00C9DB)",
            border: "none",
            color: "#0A0D16",
            fontFamily: fonts.sans,
            fontSize: 14,
            fontWeight: 700,
            cursor: "pointer",
            boxShadow: "0 0 24px rgba(0,232,157,0.3)",
            transition: "transform 0.15s, box-shadow 0.15s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = "scale(1.03)";
            e.currentTarget.style.boxShadow = "0 0 36px rgba(0,232,157,0.45)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = "scale(1)";
            e.currentTarget.style.boxShadow = "0 0 24px rgba(0,232,157,0.3)";
          }}
        >
          <Play size={16} />
          View Trained Policy
          <ArrowRight size={16} />
        </button>
        <button
          onClick={() => navigate("/analytics")}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "12px 20px",
            borderRadius: 10,
            background: "rgba(255,255,255,0.04)",
            border: `1px solid ${colors.border}`,
            color: colors.textSecondary,
            fontFamily: fonts.sans,
            fontSize: 13,
            fontWeight: 500,
            cursor: "pointer",
            transition: "all 0.15s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = "rgba(0,232,157,0.3)";
            e.currentTarget.style.color = colors.accent;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = colors.border;
            e.currentTarget.style.color = colors.textSecondary;
          }}
        >
          <Activity size={14} />
          View Analytics
        </button>
      </div>

      {/* Chat dot animation */}
      <style>{`
        @keyframes graphChatDot {
          0%, 80%, 100% { opacity: 0.2; transform: scale(0.8); }
          40% { opacity: 1; transform: scale(1.2); }
        }
      `}</style>
    </div>
  );
}

function nodeTypeToVariant(type: RLNodeType) {
  switch (type) {
    case "environment": return "info" as const;
    case "sensor": return "accent" as const;
    case "observation": return "info" as const;
    case "policy": return "warning" as const;
    case "policy_variant": return "warning" as const;
    case "action": return "success" as const;
    case "reward": return "warning" as const;
    case "metric": return "success" as const;
    case "branching": return "error" as const;
    case "state": return "error" as const;
    default: return "default" as const;
  }
}
