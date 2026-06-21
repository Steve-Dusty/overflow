/**
 * ArmorIQ — runtime intent verification for the ego-driving policy.
 *
 * ArmorIQ (https://armoriq.ai) is a control fabric for autonomous agents: it
 * captures an agent's *plan*, has it cryptographically signed by the IAP, and
 * then enforces every action against that signed intent before it executes —
 * allow / block / hold. We treat the OpenEnv ego policy as exactly such an
 * agent: every maneuver it proposes is verified here before the ego commits to
 * it. Each verification also keeps the agent "active" in the Intent dashboard.
 *
 * Architecture note: the ArmorIQ SDK (`@armoriq/sdk`) is server-side and holds
 * a *secret* api key (`ak_live_*` / `ak_claw_*`), so unlike Sentry's public DSN
 * it must NEVER be bundled into the client. All real work happens in the Vite
 * middleware at `/api/armoriq/*` (see `armoriqProxyPlugin` in vite.config.ts);
 * this module is just the browser-side caller.
 *
 * Dormant by default: with no `ARMORIQ_API_KEY` configured the proxy returns
 * `decision: "off"` and the app behaves byte-for-byte as it did before — the
 * ego policy is never blocked, never delayed. Drop the key into .env to light
 * it up.
 */

export type ArmorIQDecision = "allow" | "block" | "hold" | "off";
export type ArmorIQMode = "monitor" | "enforce";

/** Verdict returned by the proxy for a single proposed maneuver. */
export interface ArmorIQVerdict {
  /** Is ArmorIQ actually wired (server has an api key)? false ⇒ dormant. */
  configured: boolean;
  /** Whether the ego is cleared to execute the proposed action. */
  allowed: boolean;
  /** Raw enforcement decision. "off" when dormant/unreachable. */
  decision: ArmorIQDecision;
  /** "monitor" observes (never blocks); "enforce" actually gates execution. */
  mode?: ArmorIQMode;
  /** Human-readable justification from the policy engine. */
  reason?: string;
  /** Name of the policy that matched, if any. */
  matchedPolicy?: string;
  /** Intent-token id (cryptographic proof this maneuver was authorized). */
  tokenId?: string;
  /** Round-trip latency of the authorization call, ms. */
  latencyMs?: number;
}

/** A proposed ego maneuver to authorize. */
export interface ManeuverIntent {
  /** OpenEnv action, e.g. "brake_hard", "merge_left". */
  action: string;
  scenarioId: string;
  frameIndex: number;
  egoSpeed?: number;
  nearestObjectDist?: number;
  reward?: number;
}

/** The allow-all verdict used whenever ArmorIQ is off or unreachable. */
const OFF: ArmorIQVerdict = {
  configured: false,
  allowed: true,
  decision: "off",
};

// Once we learn the proxy isn't there (e.g. a static production build with no
// server), stop calling it — every maneuver would otherwise eat a failed fetch.
let _proxyAvailable = true;

/**
 * Authorize a single proposed ego maneuver with ArmorIQ.
 *
 * Always resolves (never throws): any failure degrades to the allow-all `OFF`
 * verdict so a monitoring outage can never stall or crash the simulator.
 */
export async function authorizeManeuver(intent: ManeuverIntent): Promise<ArmorIQVerdict> {
  if (!_proxyAvailable) return OFF;

  const start = performance.now();
  try {
    const resp = await fetch("/api/armoriq/authorize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(intent),
    });

    // No middleware mounted (static build / proxy disabled) — stop trying.
    if (resp.status === 404) {
      _proxyAvailable = false;
      return OFF;
    }
    if (!resp.ok) {
      return { ...OFF, reason: `armoriq proxy ${resp.status}` };
    }

    const verdict = (await resp.json()) as ArmorIQVerdict;
    verdict.latencyMs = Math.round(performance.now() - start);
    return verdict;
  } catch {
    // Network/parse failure — fail open for availability, never block the ego.
    return OFF;
  }
}

/** True when a verdict represents a live ArmorIQ decision (not the dormant path). */
export function isArmorIQActive(v: ArmorIQVerdict | null | undefined): boolean {
  return Boolean(v && v.configured && v.decision !== "off");
}

/**
 * Probe whether ArmorIQ is configured server-side, for UI affordances (e.g.
 * showing the verdict badge). Cheap GET; degrades to "off" like everything else.
 */
export async function getArmorIQStatus(): Promise<ArmorIQVerdict> {
  if (!_proxyAvailable) return OFF;
  try {
    const resp = await fetch("/api/armoriq/status");
    if (resp.status === 404) {
      _proxyAvailable = false;
      return OFF;
    }
    if (!resp.ok) return OFF;
    return (await resp.json()) as ArmorIQVerdict;
  } catch {
    return OFF;
  }
}
