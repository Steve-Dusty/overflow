/**
 * Mock GRPO training simulation — produces realistic training metrics
 * for the training dashboard. Simulates reward model training followed
 * by GRPO policy optimization.
 */

import type { TrainingMetric, TrainedModel, EvalComparison, Preference } from "./types";

// ---------------------------------------------------------------------------
// Training simulator
// ---------------------------------------------------------------------------

export interface TrainingCallbacks {
  onMetric: (metric: TrainingMetric) => void;
  onPhaseChange: (phase: string) => void;
  onComplete: (model: TrainedModel) => void;
  onLog: (message: string) => void;
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function runMockTraining(
  preferences: Preference[],
  callbacks: TrainingCallbacks,
): Promise<TrainedModel> {
  const rng = mulberry32(42);
  const totalPrefPairs = preferences.length * 3; // each preference = 3 pairs

  // ── Phase 1: Reward Model Training ──────────────────────────────
  callbacks.onPhaseChange("reward_model");
  callbacks.onLog(`Loading ${totalPrefPairs} preference pairs from ${preferences.length} reviews...`);

  await sleep(800);
  callbacks.onLog("Initializing Bradley-Terry reward model (2-layer MLP, 256 hidden)...");
  await sleep(600);
  callbacks.onLog("Training reward model on preference pairs...");

  const rmSteps = 40;
  let rmLoss = 0.72;

  for (let step = 0; step < rmSteps; step++) {
    const progress = step / (rmSteps - 1);
    rmLoss = 0.72 * Math.exp(-3.0 * progress) + 0.05 + rng() * 0.03;
    const accuracy = 0.52 + progress * 0.42 + rng() * 0.03;

    callbacks.onMetric({
      step,
      epoch: Math.floor(step / 8),
      phase: "reward_model",
      loss: rmLoss,
      avgReward: accuracy, // repurpose for accuracy during RM phase
      collisionRate: 0,
      avgTTC: 0,
      kl: 0,
      gradNorm: 2.0 * Math.exp(-1.5 * progress) + 0.1 + rng() * 0.2,
      lr: 3e-4 * (1 - progress * 0.9),
      timestamp: Date.now(),
    });

    await sleep(200 + rng() * 150);
  }

  callbacks.onLog(`Reward model converged — final loss ${rmLoss.toFixed(4)}, preference accuracy 94.2%`);
  await sleep(500);

  // ── Phase 2: GRPO Policy Optimization ───────────────────────────
  callbacks.onPhaseChange("grpo");
  callbacks.onLog("Initializing trajectory policy model (transformer, 12 layers, 198M params)...");
  await sleep(700);
  callbacks.onLog("Loading base model weights (pre-trained on Waymo Open Dataset)...");
  await sleep(600);
  callbacks.onLog("Starting GRPO optimization — K=8 candidates per scene, KL budget=0.05...");
  await sleep(400);

  const grpoSteps = 80;
  let policyLoss = 0.45;
  let avgReward = 0.25;
  let collisionRate = 0.14;
  let avgTTC = 2.1;
  let kl = 0.0;

  for (let step = 0; step < grpoSteps; step++) {
    const progress = step / (grpoSteps - 1);
    const noise = rng() * 0.05;

    // Policy improves over training
    policyLoss = 0.45 * Math.exp(-2.5 * progress) + 0.04 + noise * 0.5;
    avgReward = 0.25 + progress * 0.55 + (rng() - 0.5) * 0.06;
    collisionRate = Math.max(0.005, 0.14 * Math.exp(-4.0 * progress) + (rng() - 0.5) * 0.01);
    avgTTC = 2.1 + progress * 3.5 + (rng() - 0.5) * 0.3;
    kl = Math.min(0.05, progress * 0.06 * (1 + (rng() - 0.5) * 0.3));

    const gradNorm = 1.5 * Math.exp(-2.0 * progress) + 0.05 + rng() * 0.1;
    const lr = 3e-5 * Math.cos((progress * Math.PI) / 2);

    callbacks.onMetric({
      step: rmSteps + step,
      epoch: Math.floor(step / 10),
      phase: "grpo",
      loss: policyLoss,
      avgReward,
      collisionRate,
      avgTTC,
      kl,
      gradNorm,
      lr,
      timestamp: Date.now(),
    });

    // Occasional log messages
    if (step === 10) callbacks.onLog("GRPO: policy starting to avoid hard-braking-only trajectories");
    if (step === 25) callbacks.onLog("GRPO: collision rate dropped below 5% — defensive driving emerging");
    if (step === 40) callbacks.onLog("GRPO: reward model gradient signal strong — policy learning lateral evasion");
    if (step === 55) callbacks.onLog("GRPO: KL approaching budget — slowing learning rate");
    if (step === 70) callbacks.onLog("GRPO: policy converging — avg reward plateauing at " + avgReward.toFixed(3));

    await sleep(180 + rng() * 120);
  }

  callbacks.onLog(`GRPO complete — final reward ${avgReward.toFixed(3)}, collision rate ${(collisionRate * 100).toFixed(1)}%`);
  await sleep(400);

  // ── Phase 3: Evaluation ─────────────────────────────────────────
  callbacks.onPhaseChange("eval");
  callbacks.onLog("Running evaluation on held-out incidents...");
  await sleep(1000);
  callbacks.onLog("Comparing policy v1 (base) vs v2 (GRPO-trained)...");
  await sleep(800);

  const evalSteps = 10;
  for (let step = 0; step < evalSteps; step++) {
    callbacks.onMetric({
      step: rmSteps + grpoSteps + step,
      epoch: 0,
      phase: "eval",
      loss: 0,
      avgReward: avgReward + (rng() - 0.5) * 0.03,
      collisionRate: collisionRate + (rng() - 0.5) * 0.005,
      avgTTC: avgTTC + (rng() - 0.5) * 0.2,
      kl: 0,
      gradNorm: 0,
      lr: 0,
      timestamp: Date.now(),
    });
    await sleep(300);
  }

  // ── Build final model ───────────────────────────────────────────
  const comparisons: EvalComparison[] = [
    { metric: "Avg Reward", before: 0.34, after: Math.round(avgReward * 1000) / 1000, unit: "", improved: avgReward > 0.34 },
    { metric: "Collision Rate", before: 12.0, after: Math.round(collisionRate * 1000) / 10, unit: "%", improved: collisionRate < 0.12 },
    { metric: "Avg TTC", before: 2.1, after: Math.round(avgTTC * 10) / 10, unit: "s", improved: avgTTC > 2.1 },
    { metric: "Safety Score", before: 0.42, after: Math.round((1 - collisionRate) * 100) / 100, unit: "", improved: true },
    { metric: "Hard Brakes / Episode", before: 4.2, after: Math.round((0.8 + rng() * 0.5) * 10) / 10, unit: "", improved: true },
    { metric: "Avg Clearance", before: 2.8, after: Math.round((4.2 + rng() * 1.0) * 10) / 10, unit: "m", improved: true },
  ];

  const model: TrainedModel = {
    version: `v2-grpo-${Date.now().toString(36)}`,
    name: "overflow-policy-grpo",
    trainedAt: Date.now(),
    preferences: preferences.length,
    epochs: Math.floor(grpoSteps / 10),
    steps: rmSteps + grpoSteps,
    evalMetrics: {
      avgReward: Math.round(avgReward * 1000) / 1000,
      collisionRate: Math.round(collisionRate * 1000) / 1000,
      avgTTC: Math.round(avgTTC * 10) / 10,
      safetyScore: Math.round((1 - collisionRate) * 100) / 100,
    },
    comparisons,
  };

  callbacks.onLog("Evaluation complete.");
  callbacks.onComplete(model);

  return model;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
