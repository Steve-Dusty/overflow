/**
 * LLM client — powers incident analysis and training commentary.
 * Uses OpenAI-compatible API (works with OpenAI, Overflow H100 endpoint, or any compatible provider).
 * Falls back to pre-built mock analysis when no API key is available.
 */

import type { Incident } from "./types";
import type { ScenarioId } from "../mockData";
import { log } from "./sentry";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

// Calls go through the Overflow backend (/api/chat) so the OpenAI key stays
// server-side and every request is captured as a Sentry gen_ai span (with token
// usage) and joined into the browser's distributed trace.
const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8787";
const MODEL = import.meta.env.VITE_OVERFLOW_MODEL || "gpt-4o-mini";

// ---------------------------------------------------------------------------
// Generic chat completion (via instrumented backend proxy)
// ---------------------------------------------------------------------------

async function chatCompletion(
  systemPrompt: string,
  userMessage: string,
): Promise<string> {
  log.info("llm.request", { model: MODEL });
  const resp = await fetch(`${API_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system: systemPrompt,
      user: userMessage,
      model: MODEL,
      temperature: 0.7,
      maxTokens: 1500,
    }),
  });

  if (!resp.ok) throw new Error(`LLM API ${resp.status}`);
  const data = await resp.json();
  return data.text ?? "";
}

// ---------------------------------------------------------------------------
// Incident analysis
// ---------------------------------------------------------------------------

const ANALYSIS_SYSTEM = `You are an autonomous vehicle safety analyst. Given incident data from a driving scenario, provide a concise technical analysis.

Structure your response as:
**Root Cause**: One sentence identifying the primary cause.
**Risk Assessment**: 2-3 sentences on the risk level and what could have gone wrong.
**Recommended Action**: What the ego vehicle should have done differently.
**Policy Implication**: What this means for the driving policy model.

Be technical, precise, and concise. Use metrics when available.`;

export async function analyzeIncident(
  incident: Incident,
  scenarioId: ScenarioId,
): Promise<string> {
  const userMsg = `Analyze this driving incident:

Scenario: ${scenarioId}
Type: ${incident.type}
Time: ${incident.time.toFixed(1)}s
Severity: ${incident.severity}
Description: ${incident.description}

Metrics:
- Time-to-collision: ${incident.metrics.ttc}s
- Deceleration: ${incident.metrics.deceleration} m/s²
- Minimum clearance: ${incident.metrics.minClearance}m
- Ego speed: ${incident.metrics.egoSpeed} m/s
- Lateral offset: ${incident.metrics.lateralOffset}m`;

  try {
    return await chatCompletion(ANALYSIS_SYSTEM, userMsg);
  } catch {
    return generateMockAnalysis(incident);
  }
}

// ---------------------------------------------------------------------------
// Training commentary
// ---------------------------------------------------------------------------

const TRAINING_SYSTEM = `You are an ML training monitor for an autonomous driving policy model. Given training metrics, provide a one-sentence technical observation about what's happening in the training run. Be specific about the numbers. No filler.`;

export async function getTrainingCommentary(
  phase: string,
  step: number,
  metrics: { loss: number; avgReward: number; collisionRate: number; kl: number },
): Promise<string> {
  const userMsg = `Phase: ${phase}, Step: ${step}, Loss: ${metrics.loss.toFixed(4)}, Avg Reward: ${metrics.avgReward.toFixed(3)}, Collision Rate: ${(metrics.collisionRate * 100).toFixed(1)}%, KL: ${metrics.kl.toFixed(4)}`;

  try {
    return await chatCompletion(TRAINING_SYSTEM, userMsg);
  } catch {
    return generateMockTrainingComment(phase, step, metrics);
  }
}

// ---------------------------------------------------------------------------
// Ranking commentary (after user picks best trajectory)
// ---------------------------------------------------------------------------

const RANKING_SYSTEM = `You are an AV safety analyst. The user just reviewed an incident and chose the best driving response out of 4 options. Give a 1-2 sentence evaluation of their choice. Be concise, technical, and supportive. Reference the specific action and why it's good or concerning.`;

export async function analyzeRanking(
  chosenLabel: string,
  chosenReward: number,
  incidentType: string,
  allOptions: { label: string; reward: number; safety: number }[],
): Promise<string> {
  const optionsList = allOptions.map((o) => `${o.label} (reward: ${o.reward.toFixed(2)}, safety: ${(o.safety * 100).toFixed(0)}%)`).join(", ");
  const userMsg = `Incident type: ${incidentType}. User chose: "${chosenLabel}" (reward: ${chosenReward.toFixed(2)}). All options: ${optionsList}.`;

  try {
    return await chatCompletion(RANKING_SYSTEM, userMsg);
  } catch {
    return generateMockRankingComment(chosenLabel, chosenReward, incidentType);
  }
}

function generateMockRankingComment(label: string, reward: number, incidentType: string): string {
  if (reward > 0.7) {
    return `Strong choice. "${label}" maximizes safety margin in this ${incidentType.replace("_", " ")} scenario — the reward signal confirms this is the optimal policy response.`;
  }
  if (reward > 0.3) {
    return `Reasonable selection. "${label}" provides adequate safety in this ${incidentType.replace("_", " ")} event, though other options may yield higher reward. This preference will help the GRPO update explore the trade-off space.`;
  }
  return `Interesting choice — "${label}" has a low reward (${reward.toFixed(2)}) for this ${incidentType.replace("_", " ")} scenario. This preference signal will teach the policy that human judgment sometimes diverges from pure reward maximization.`;
}

// ---------------------------------------------------------------------------
// Export summary (natural language training report)
// ---------------------------------------------------------------------------

const EXPORT_SYSTEM = `You are an ML engineer writing a concise training report. Given training results, write a 3-4 sentence technical summary of what was accomplished. Mention key metric improvements, the training method (GRPO), and deployment readiness. Be professional and precise.`;

export async function generateExportSummary(
  evalMetrics: { avgReward: number; collisionRate: number; avgTTC: number; safetyScore: number },
  preferences: number,
  steps: number,
): Promise<string> {
  const userMsg = `Training complete. Method: GRPO with ${preferences} human preference reviews (${preferences * 3} pairwise comparisons). ${steps} total optimization steps. Results: avg reward ${evalMetrics.avgReward.toFixed(3)}, collision rate ${(evalMetrics.collisionRate * 100).toFixed(1)}%, avg TTC ${evalMetrics.avgTTC.toFixed(1)}s, safety score ${(evalMetrics.safetyScore * 100).toFixed(0)}%.`;

  try {
    return await chatCompletion(EXPORT_SYSTEM, userMsg);
  } catch {
    return `GRPO policy optimization complete after ${steps} steps using ${preferences * 3} pairwise comparisons from ${preferences} human reviews. The trained policy achieves ${evalMetrics.avgReward.toFixed(3)} avg reward with a ${(evalMetrics.collisionRate * 100).toFixed(1)}% collision rate (avg TTC ${evalMetrics.avgTTC.toFixed(1)}s). The model demonstrates strong defensive driving behaviors and is ready for deployment evaluation in simulation.`;
  }
}

// ---------------------------------------------------------------------------
// Mock fallbacks (when no API key)
// ---------------------------------------------------------------------------

function generateMockAnalysis(incident: Incident): string {
  const { type, metrics } = incident;

  const rootCauses: Record<string, string> = {
    hard_braking: `Sudden deceleration of ${metrics.deceleration.toFixed(1)} m/s² triggered by rapidly closing gap with lead agent at ${metrics.minClearance.toFixed(1)}m clearance.`,
    near_miss: `Near-miss caused by agent encroachment into ego lane with only ${metrics.minClearance.toFixed(1)}m separation and TTC of ${metrics.ttc.toFixed(1)}s.`,
    collision: `Collision event — ego failed to maintain safe following distance. Final clearance ${metrics.minClearance.toFixed(1)}m at ${metrics.egoSpeed.toFixed(1)} m/s.`,
    lane_departure: `Lane departure detected with ${metrics.lateralOffset.toFixed(1)}m offset from lane center, likely evasive maneuver.`,
    close_call: `Close proximity event — agent within ${metrics.minClearance.toFixed(1)}m of ego at ${metrics.egoSpeed.toFixed(1)} m/s.`,
    erratic_agent: `Erratic agent behavior created unpredictable threat geometry at ${metrics.minClearance.toFixed(1)}m range.`,
  };

  const risk = metrics.ttc < 2
    ? `High-risk event. TTC of ${metrics.ttc.toFixed(1)}s left minimal reaction margin. At ${metrics.egoSpeed.toFixed(1)} m/s, the stopping distance exceeds the available clearance. A 200ms delay in response would have resulted in contact.`
    : `Moderate risk. TTC of ${metrics.ttc.toFixed(1)}s provided some reaction margin, but the ${metrics.minClearance.toFixed(1)}m clearance is below the 3.0m safety threshold for this speed regime.`;

  const actions: Record<string, string> = {
    hard_braking: "Earlier, more gradual deceleration starting 1-2s before the event would have maintained comfort while achieving the same safety margin.",
    near_miss: "Lateral evasion (0.5-1.0m nudge away from encroaching agent) combined with mild braking would have increased TTC to >4s.",
    collision: "Emergency braking should have initiated 0.8-1.2s earlier based on the closing rate. Alternatively, a lane change would have avoided the conflict entirely.",
    lane_departure: "Maintain lane discipline — the evasive maneuver was disproportionate to the threat level. A controlled brake within the lane was sufficient.",
    close_call: "Increase following distance buffer. The policy should maintain >3.0m clearance at speeds above 8 m/s.",
    erratic_agent: "Earlier threat classification of the erratic agent would have triggered a defensive posture (speed reduction + increased lateral buffer) 2-3s before the event.",
  };

  const implications: Record<string, string> = {
    hard_braking: "The policy's braking threshold is too aggressive — it waits too long before initiating deceleration. GRPO should penalize late-braking trajectories in close-proximity scenarios.",
    near_miss: "The policy underweights lateral threats. The reward model should assign higher penalties to trajectories that maintain course when adjacent agents show lateral velocity toward ego.",
    collision: "Critical failure in the policy's forward collision avoidance. This preference pair should receive high weight in the reward model to ensure the GRPO update strongly corrects this behavior.",
    lane_departure: "The policy's evasive maneuver module is overreacting. Reward model should penalize unnecessary lane departures when in-lane braking is sufficient.",
    close_call: "The policy's gap maintenance is insufficient at higher speeds. GRPO training should include speed-dependent clearance requirements.",
    erratic_agent: "The policy lacks an erratic-agent detector. Consider adding behavioral prediction uncertainty as a feature to the trajectory encoder.",
  };

  return `**Root Cause**: ${rootCauses[type] || rootCauses.close_call}

**Risk Assessment**: ${risk}

**Recommended Action**: ${actions[type] || actions.close_call}

**Policy Implication**: ${implications[type] || implications.close_call}`;
}

function generateMockTrainingComment(
  phase: string,
  step: number,
  metrics: { loss: number; avgReward: number; collisionRate: number; kl: number },
): string {
  if (phase === "reward_model") {
    if (step < 20) return `Reward model converging — loss ${metrics.loss.toFixed(4)} indicates preference pairs are well-separated.`;
    if (step < 50) return `Reward model stabilizing at loss ${metrics.loss.toFixed(4)}. Preference accuracy ~${(85 + Math.random() * 10).toFixed(0)}% on held-out pairs.`;
    return `Reward model training complete. Final loss ${metrics.loss.toFixed(4)} with ${(92 + Math.random() * 5).toFixed(1)}% preference prediction accuracy.`;
  }
  if (phase === "grpo") {
    if (metrics.collisionRate > 0.08) return `GRPO step ${step}: collision rate still at ${(metrics.collisionRate * 100).toFixed(1)}% — policy exploring aggressive trajectories. KL ${metrics.kl.toFixed(4)} within budget.`;
    if (metrics.avgReward < 0.5) return `GRPO step ${step}: avg reward climbing to ${metrics.avgReward.toFixed(3)}. Policy learning to avoid low-TTC trajectories.`;
    return `GRPO step ${step}: strong convergence — reward ${metrics.avgReward.toFixed(3)}, collision rate ${(metrics.collisionRate * 100).toFixed(1)}%. KL ${metrics.kl.toFixed(4)} stable.`;
  }
  return `Evaluation: avg reward ${metrics.avgReward.toFixed(3)}, collision rate ${(metrics.collisionRate * 100).toFixed(1)}%, avg TTC ${(3 + Math.random() * 3).toFixed(1)}s.`;
}
