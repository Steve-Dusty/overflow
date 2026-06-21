/**
 * OpenEnv client — fetches action/reward from the OpenEnv model.
 * Supports REAL mode (API endpoint) and MOCK mode (deterministic pseudo-random).
 */

export interface OpenEnvInput {
  frameIndex: number;
  egoX: number;
  egoY: number;
  egoSpeed: number;
  nearestObjectDist: number;
  scenarioId: string;
  branchSeed?: number;
}

export interface OpenEnvOutput {
  action: OpenEnvAction;
  reward: number;
  branchId: string;
  explanation: string;
  timestamp: number;
  latencyMs: number;
}

export type OpenEnvAction =
  | "keep_lane"
  | "brake_mild"
  | "brake_hard"
  | "accelerate"
  | "merge_left"
  | "merge_right"
  | "yield"
  | "nudge_left"
  | "nudge_right";

const ACTIONS: OpenEnvAction[] = [
  "keep_lane", "brake_mild", "brake_hard", "accelerate",
  "merge_left", "merge_right", "yield", "nudge_left", "nudge_right",
];

const EXPLANATIONS: Record<OpenEnvAction, string> = {
  keep_lane: "No immediate hazard detected. Maintaining current lane and speed is optimal.",
  brake_mild: "Object closing distance ahead. Mild braking reduces TTC risk while maintaining flow.",
  brake_hard: "Critical proximity event. Hard braking avoids collision with high confidence.",
  accelerate: "Gap ahead is opening. Accelerating improves traffic flow and reduces rear-end risk.",
  merge_left: "Left lane is clear and offers better forward visibility. Merging improves safety margin.",
  merge_right: "Right lane merge avoids potential conflict with approaching vehicle.",
  yield: "Right-of-way ambiguity detected. Yielding reduces collision probability.",
  nudge_left: "Slight lateral offset avoids encroaching object while staying in lane.",
  nudge_right: "Slight rightward nudge increases buffer from oncoming traffic.",
};

// Seeded PRNG (mulberry32)
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mockAction(input: OpenEnvInput, seed: number): OpenEnvOutput {
  const rng = mulberry32(seed + input.frameIndex * 137);
  const r1 = rng();
  const r2 = rng();
  const r3 = rng();

  // Bias action selection based on scenario context
  let action: OpenEnvAction;
  if (input.nearestObjectDist < 5) {
    // Close proximity — favor braking/yielding
    const urgentActions: OpenEnvAction[] = ["brake_hard", "brake_mild", "yield", "nudge_left", "nudge_right"];
    action = urgentActions[Math.floor(r1 * urgentActions.length)];
  } else if (input.nearestObjectDist < 15) {
    const cautious: OpenEnvAction[] = ["brake_mild", "keep_lane", "merge_left", "nudge_right", "yield"];
    action = cautious[Math.floor(r1 * cautious.length)];
  } else {
    const relaxed: OpenEnvAction[] = ["keep_lane", "accelerate", "keep_lane", "merge_left"];
    action = relaxed[Math.floor(r1 * relaxed.length)];
  }

  // Reward: higher for safer actions when close, higher for flow when far
  let reward = 0;
  if (input.nearestObjectDist < 5) {
    reward = action.includes("brake") || action === "yield" ? 0.7 + r2 * 0.3 : -0.2 + r2 * 0.3;
  } else if (input.nearestObjectDist < 15) {
    reward = 0.3 + r2 * 0.5;
  } else {
    reward = 0.5 + r2 * 0.4;
  }

  // Add some noise
  reward = Math.max(-1, Math.min(1, reward + (r3 - 0.5) * 0.15));

  const branchId = `br-${seed.toString(36).slice(0, 4)}-${input.frameIndex}`;

  return {
    action,
    reward: Math.round(reward * 1000) / 1000,
    branchId,
    explanation: EXPLANATIONS[action],
    timestamp: Date.now(),
    latencyMs: 20 + Math.floor(r1 * 80),
  };
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

type Mode = "real" | "mock";

let _mode: Mode = "mock";
let _endpoint = "";
let _pollIntervalMs = 3000;

export function configureOpenEnv(opts: { mode?: Mode; endpoint?: string; pollInterval?: number }) {
  if (opts.mode) _mode = opts.mode;
  if (opts.endpoint) _endpoint = opts.endpoint;
  if (opts.pollInterval) _pollIntervalMs = opts.pollInterval;
}

export function getOpenEnvMode(): Mode {
  return _mode;
}

export function getPollInterval(): number {
  return _pollIntervalMs;
}

export async function getActionAndReward(input: OpenEnvInput): Promise<OpenEnvOutput> {
  const start = performance.now();

  if (_mode === "real" && _endpoint) {
    try {
      const resp = await fetch(_endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!resp.ok) throw new Error(`OpenEnv API ${resp.status}`);
      const data = await resp.json();
      return {
        ...data,
        latencyMs: Math.round(performance.now() - start),
        timestamp: Date.now(),
      };
    } catch {
      // Fall back to mock
      console.warn("[openenv] API unreachable, falling back to mock");
    }
  }

  // Mock mode — add small artificial delay for realism
  await new Promise((r) => setTimeout(r, 40 + Math.random() * 60));
  const seed = input.branchSeed ?? Math.floor(Math.random() * 100000);
  const result = mockAction(input, seed);
  result.latencyMs = Math.round(performance.now() - start);
  return result;
}

/**
 * Request N variant actions for counterfactual branching.
 * Each variant uses a different seed to produce different action/reward.
 */
export async function getCounterfactualVariants(
  input: OpenEnvInput,
  count: number,
): Promise<OpenEnvOutput[]> {
  const baseSeed = Date.now();
  const promises = Array.from({ length: count }, (_, i) =>
    getActionAndReward({ ...input, branchSeed: baseSeed + i * 7919 })
  );
  return Promise.all(promises);
}
