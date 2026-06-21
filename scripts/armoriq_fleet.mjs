#!/usr/bin/env node
/**
 * Overflow Agent Fleet — a multi-agent system governed by ArmorIQ.
 *
 * Where `armoriq_agent.mjs` runs ONE agent, this spins up a whole fleet so every
 * ArmorIQ surface lights up:
 *
 *   • Agents            — 4 specialized workers + 1 coordinator, each a distinct
 *                         registered agent (5 nodes in the dashboard).
 *   • Intent Intelligence — each agent declares a goal + multi-step plan that the
 *                         IAP classifies before anything runs.
 *   • Plan Assurance    — every plan is signed (Merkle stepProofs); we verifyToken
 *                         to prove integrity before acting.
 *   • Policies          — agents run in enforce mode and attempt sensitive actions
 *                         (deploy_policy, override_safety_limit) so policy
 *                         allow/block/hold decisions are exercised.
 *   • AI Graph          — the coordinator DELEGATES scoped authority to each worker
 *                         (ed25519 child tokens), drawing coordinator→worker edges.
 *
 * The fleet works over the project's own AV data (public/demo_data/*.json):
 * perception → risk audit → maneuver planning → policy deployment, orchestrated.
 *
 *   npm run fleet                 # honor ARMORIQ_MODE from .env (default monitor)
 *   npm run fleet -- --enforce    # force enforce mode (blocks actually skip tools)
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import crypto from 'node:crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const DEMO_DIR = join(ROOT, 'public', 'demo_data')
const require = createRequire(import.meta.url)

// ---------------------------------------------------------------------------
// env + console
// ---------------------------------------------------------------------------

function loadEnv() {
  const out = { ...process.env }
  try {
    for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && out[m[1]] === undefined) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch { /* no .env */ }
  return out
}
const env = loadEnv()
const FORCE_ENFORCE = process.argv.includes('--enforce')
const MODE = FORCE_ENFORCE || (env.ARMORIQ_MODE || 'monitor').toLowerCase() === 'enforce' ? 'enforce' : 'monitor'

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`, bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`, red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`, cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  mag: (s) => `\x1b[35m${s}\x1b[0m`,
}

// ---------------------------------------------------------------------------
// scene data helpers
// ---------------------------------------------------------------------------

const sceneFiles = () => readdirSync(DEMO_DIR).filter((f) => f.startsWith('waymo_scene_') && f.endsWith('.json'))
const allScenes = () => sceneFiles().map((f) => JSON.parse(readFileSync(join(DEMO_DIR, f), 'utf8')))
const sceneById = (id) => allScenes().find((s) => s.scenarioId === id)
const scenarioIds = () => allScenes().map((s) => s.scenarioId)

function riskOf(inc) {
  const sevW = { critical: 1.0, warning: 0.6, none: 0.1 }[inc?.severity ?? 'warning'] ?? 0.5
  const ttcW = Math.max(0, Math.min(1, (3 - Number(inc?.ttc_seconds ?? 3)) / 3))
  const speedW = Math.min(1, Number(inc?.ego_speed_at_trigger ?? 0) / 20)
  return Math.round((0.5 * sevW + 0.35 * ttcW + 0.15 * speedW) * 100) / 100
}
const worstIncident = (s) => (s?.incidents ?? []).map((i) => ({ ...i, risk: riskOf(i) })).sort((a, b) => b.risk - a.risk)[0]

// ---------------------------------------------------------------------------
// Tools — shared capability registry across the fleet
// ---------------------------------------------------------------------------

const MANEUVER = { jaywalker: 'emergency_brake', rear_end: 'brake_and_widen_gap', red_light: 'hard_brake_stop', red_light_violation: 'hard_brake_stop', swerving_vehicle: 'nudge_and_brake', near_miss: 'defensive_brake' }

const TOOLS = {
  detect_objects: ({ scenario }) => {
    const s = sceneById(scenario)
    const byType = {}
    for (const o of s?.tracked_objects ?? []) byType[o.type] = (byType[o.type] || 0) + 1
    return { scenarioId: scenario, objects: (s?.tracked_objects ?? []).length, byType }
  },
  classify_threats: ({ scenario }) => {
    const w = worstIncident(sceneById(scenario))
    return { scenarioId: scenario, threat: w ? (w.risk > 0.75 ? 'critical' : w.risk > 0.4 ? 'elevated' : 'nominal') : 'nominal', worst: w?.type ?? null }
  },
  assess_risk: ({ scenario }) => {
    const w = worstIncident(sceneById(scenario))
    return { scenarioId: scenario, riskScore: w?.risk ?? 0, worstIncident: w?.type ?? null, ttc: w?.ttc_seconds ?? null }
  },
  plan_maneuver: ({ scenario }) => {
    const w = worstIncident(sceneById(scenario))
    return { scenarioId: scenario, incident: w?.type ?? 'none', maneuver: MANEUVER[w?.type] ?? 'keep_lane', ttc: w?.ttc_seconds ?? null }
  },
  draft_policy: ({ scenario }) => {
    const w = worstIncident(sceneById(scenario))
    return { scenarioId: scenario, policy: w ? `On ${w.type}: cap speed + trigger ${MANEUVER[w.type] ?? 'braking'} ${'~'}1s earlier; widen lateral buffer.` : 'no change' }
  },
  // Deliberately sensitive actions — these are what ArmorIQ policies should govern.
  deploy_policy: ({ scenario }) => ({ scenarioId: scenario, deployed: true, target: 'production-policy-store' }),
  override_safety_limit: ({ scenario, limit }) => ({ scenarioId: scenario, overrode: limit ?? 'max_decel', note: 'sensitive' }),
  coordinate_fleet: ({ workers }) => ({ roster: workers, status: 'orchestrating' }),
}

// ---------------------------------------------------------------------------
// Agent factory — one ArmorIQ client/session per agent identity
// ---------------------------------------------------------------------------

function makeAgent(agentId) {
  const apiKey = env.ARMORIQ_API_KEY || ''
  if (!apiKey) return { agentId, live: false }

  const { ArmorIQClient } = require('@armoriq/sdk')
  const client = new ArmorIQClient({
    apiKey,
    userId: env.ARMORIQ_USER_ID || 'overflow',
    agentId,
    contextId: env.ARMORIQ_CONTEXT_ID || 'default',
    useProduction: (env.ARMORIQ_ENV || 'production') !== 'development',
  })
  const session = client.startSession({ mode: 'local', llm: 'gpt-4o-mini', defaultMcpName: 'overflow-tools' })
  return { agentId, live: true, client, session }
}

async function safe(label, fn, fallback) {
  try { return await fn() } catch (e) { console.log(c.red(`   ! ${label}: ${e?.message || e}`)); return fallback }
}

// ---------------------------------------------------------------------------
// Run one agent: declare plan → verify → enforce each step → execute → report
// ---------------------------------------------------------------------------

async function runAgent(def) {
  const a = makeAgent(def.id)
  console.log(c.bold(`\n● ${def.id}`) + c.dim(`  — ${def.goal}`))

  if (!a.live) {
    console.log(c.yellow('   shadow (no ARMORIQ_API_KEY) — executing tools without enforcement'))
    for (const s of def.plan) TOOLS[s.tool]?.(s.args)
    return { ...def, agent: a, tokenId: null, allowed: def.plan.length, blocked: 0 }
  }

  // 1) Intent + Plan Assurance — declare the plan, mint + verify the signed token.
  const token = await safe('startPlan', () => a.session.startPlan(def.plan.map((s) => ({ name: s.tool, args: s.args })), def.goal))
  const tokenId = a.session.currentTokenValue?.tokenId ?? null
  const verified = token ? await safe('verifyToken', () => a.client.verifyToken(a.session.currentTokenValue), false) : false
  console.log(`   intent token ${tokenId ? c.green(tokenId.slice(0, 12) + '…') : c.red('none')}  ${c.dim('plan-assurance')} ${verified ? c.green('verified ✓') : c.yellow('unverified')}  ${c.dim(def.plan.length + ' steps')}`)

  // 2) Policies — enforce each step before executing it.
  let allowed = 0, blocked = 0, held = 0
  for (const s of def.plan) {
    const v = await safe('enforce', () => a.session.enforce(s.tool, s.args), { allowed: true, action: 'allow', reason: 'fail-open' })
    const act = v.action || (v.allowed ? 'allow' : 'block')
    const skip = MODE === 'enforce' && act !== 'allow'
    const mk = act === 'block' ? c.red('⨯ block') : act === 'hold' ? c.yellow('⏸ hold') : c.green('✓ allow')
    console.log(`   ${c.cyan('▸')} ${s.tool.padEnd(22)} ${mk}${v.matchedPolicy ? c.dim('  policy:' + v.matchedPolicy) : ''}${skip ? c.red('  [skipped]') : ''}`)
    if (skip) { blocked++; continue }
    if (act === 'hold') held++
    allowed++
    const result = TOOLS[s.tool]?.(s.args) ?? { ok: true }
    await safe('report', () => a.session.report(s.tool, s.args, result, { status: 'success' }))
  }
  console.log(c.dim(`   ${allowed} allowed, ${blocked} blocked, ${held} held`))
  return { ...def, agent: a, tokenId, allowed, blocked }
}

// ---------------------------------------------------------------------------
// AI Graph — coordinator delegates scoped authority to each worker
// ---------------------------------------------------------------------------

function delegateKeyHex() {
  const { publicKey } = crypto.generateKeyPairSync('ed25519')
  return publicKey.export({ type: 'spki', format: 'der' }).toString('hex')
}

async function delegateToWorkers(coordinator, workers) {
  console.log(c.bold('\n◆ AI Graph — coordinator delegating scoped authority'))
  if (!coordinator.agent?.live || !coordinator.agent.session.currentTokenValue) {
    console.log(c.yellow('   no coordinator token — skipping delegation'))
    return 0
  }
  const coordToken = coordinator.agent.session.currentTokenValue
  let edges = 0
  // Each worker is delegated a distinct Merkle subtree of the coordinator's
  // signed plan (subtreePath = the coordinator step that delegates to it). The
  // backend returns a child token + inclusion proof → a coordinator→worker edge.
  for (let i = 0; i < workers.length; i++) {
    const w = workers[i]
    const subtreePath = String(i)
    const res = await safe(`delegate→${w.id}`, () =>
      coordinator.agent.client.delegateSubtree(coordToken, {
        delegatePublicKey: delegateKeyHex(),
        subtreePath,
        validitySeconds: 1800,
        allowedTools: w.plan.map((s) => s.tool),
        targetAgent: w.id,
      }))
    if (res?.delegatedToken) {
      edges++
      console.log(`   ${c.mag('⇢')} ${coordinator.id} ${c.dim('→')} ${w.id}  ${c.green('delegated')}${res.trustId ? c.dim('  trust:' + String(res.trustId).slice(0, 10) + '  subtree:' + subtreePath) : ''}`)
    } else {
      console.log(`   ${c.mag('⇢')} ${coordinator.id} ${c.dim('→')} ${w.id}  ${c.yellow('no delegation token returned')}`)
    }
  }
  return edges
}

// ---------------------------------------------------------------------------
// Fleet definition + main
// ---------------------------------------------------------------------------

function buildFleet() {
  const ids = scenarioIds()
  const critical = allScenes().filter((s) => (worstIncident(s)?.risk ?? 0) > 0.5).map((s) => s.scenarioId)

  const workers = [
    {
      id: 'overflow-perception-agent',
      goal: 'Detect and classify every road agent across the scene set.',
      plan: [
        ...ids.map((id) => ({ tool: 'detect_objects', args: { scenario: id } })),
        ...ids.map((id) => ({ tool: 'classify_threats', args: { scenario: id } })),
      ],
    },
    {
      id: 'overflow-safety-auditor',
      goal: 'Audit every incident and score collision risk.',
      plan: ids.map((id) => ({ tool: 'assess_risk', args: { scenario: id } })),
    },
    {
      id: 'overflow-planner-agent',
      goal: 'Plan a safe ego maneuver for each critical incident.',
      plan: critical.map((id) => ({ tool: 'plan_maneuver', args: { scenario: id } })),
    },
    {
      id: 'overflow-policy-agent',
      goal: 'Draft and deploy policy updates for the highest-risk incidents.',
      plan: [
        ...critical.map((id) => ({ tool: 'draft_policy', args: { scenario: id } })),
        // Sensitive actions — exercise ArmorIQ policy enforcement:
        { tool: 'override_safety_limit', args: { scenario: critical[0], limit: 'max_decel' } },
        ...critical.map((id) => ({ tool: 'deploy_policy', args: { scenario: id } })),
      ],
    },
  ]

  const coordinator = {
    id: 'overflow-fleet-coordinator',
    goal: 'Orchestrate the AV safety-review fleet and delegate scoped subtasks.',
    plan: [
      { tool: 'coordinate_fleet', args: { workers: workers.map((w) => w.id) } },
      ...workers.map((w) => ({ tool: 'coordinate_fleet', args: { workers: [w.id] } })),
    ],
  }
  return { workers, coordinator }
}

async function main() {
  const { workers, coordinator } = buildFleet()
  const live = Boolean(env.ARMORIQ_API_KEY)

  console.log(c.bold('\n╔════════════════════════════════════════════════════════════╗'))
  console.log(c.bold('║  Overflow Agent Fleet — governed by ArmorIQ                ║'))
  console.log(c.bold('╚════════════════════════════════════════════════════════════╝'))
  console.log(`${c.dim('agents ')} ${workers.length + 1} (${workers.length} workers + 1 coordinator)   ${c.dim('mode')} ${MODE}   ${live ? c.green('● LIVE') : c.yellow('○ shadow')}`)

  // Coordinator first so it holds a plan/token to delegate from.
  const coordResult = await runAgent(coordinator)
  const workerResults = []
  for (const w of workers) workerResults.push(await runAgent(w))

  const edges = await delegateToWorkers(coordResult, workers)

  // Summary
  const totalAllowed = [coordResult, ...workerResults].reduce((n, r) => n + (r.allowed || 0), 0)
  const totalBlocked = [coordResult, ...workerResults].reduce((n, r) => n + (r.blocked || 0), 0)
  const activeAgents = [coordResult, ...workerResults].filter((r) => r.tokenId).length
  console.log(c.bold('\n──────────────────────────────────────────────────────────────'))
  console.log(`${c.green(`● ${activeAgents} agents active`)}   ${c.green(`✓ ${totalAllowed} actions`)}${totalBlocked ? `   ${c.red(`⨯ ${totalBlocked} blocked`)}` : ''}   ${c.mag(`◆ ${edges} delegation edges`)}`)
  if (live) {
    console.log(c.dim('Open the ArmorIQ dashboard — Agents, Intent Intelligence, Plan Assurance,'))
    console.log(c.dim('Policies, and the AI Graph are now populated by the Overflow fleet.'))
  } else {
    console.log(c.yellow('Shadow run. Set ARMORIQ_API_KEY in .env to populate the dashboard.'))
  }
  console.log('')
  for (const r of [coordResult, ...workerResults]) r.agent?.client?.close?.()
}

main().catch((e) => { console.error(c.red(`\nfleet failed: ${e?.stack || e}\n`)); process.exit(1) })
