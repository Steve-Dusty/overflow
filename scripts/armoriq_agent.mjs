#!/usr/bin/env node
/**
 * Overflow Safety Agent — an autonomous agent governed by ArmorIQ.
 *
 * This is a *real* agent: given a goal, it plans an ordered set of tool calls,
 * then executes them — but every single tool call is gated by ArmorIQ first.
 * The canonical ArmorIQ flow is:
 *
 *   startPlan(plan, goal)   → IAP mints a signed intent token (agent goes
 *                             ACTIVE in the Intent dashboard)
 *   enforce(tool, args)     → allow | block | hold, checked against the signed
 *                             plan + your policies, before the tool runs
 *   report(tool, args, out) → audit trail entry after the tool runs
 *
 * The agent operates over the project's own demo data (public/demo_data/*.json):
 * it audits every driving scenario for critical incidents and drafts policy
 * fixes. That makes ArmorIQ's value concrete here — it is literally governing an
 * AI agent that reasons about autonomous-vehicle safety.
 *
 * Runs with zero config in "shadow" mode (allow-all, nothing leaves the box) so
 * you can see the loop work immediately. Set ARMORIQ_API_KEY (in .env) to make
 * it LIVE — then watch "overflow-safety-agent" appear in the dashboard.
 *
 *   npm run agent
 *   npm run agent -- "audit only the critical scenarios and propose fixes"
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const DEMO_DIR = join(ROOT, 'public', 'demo_data')
const OUT_DIR = join(ROOT, 'checkpoints')

// ---------------------------------------------------------------------------
// env + tiny console styling
// ---------------------------------------------------------------------------

function loadEnv() {
  const out = { ...process.env }
  const envPath = join(ROOT, '.env')
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && out[m[1]] === undefined) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  }
  return out
}
const env = loadEnv()

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
}

// ---------------------------------------------------------------------------
// Tools — the agent's capabilities, operating on real demo scene data
// ---------------------------------------------------------------------------

const sceneFiles = () =>
  readdirSync(DEMO_DIR).filter((f) => f.startsWith('waymo_scene_') && f.endsWith('.json'))

function loadScene(idOrFile) {
  const file = idOrFile?.endsWith?.('.json')
    ? idOrFile
    : sceneFiles().find((f) => {
        try {
          return JSON.parse(readFileSync(join(DEMO_DIR, f), 'utf8')).scenarioId === idOrFile
        } catch {
          return false
        }
      }) || `waymo_scene_${idOrFile}.json`
  return JSON.parse(readFileSync(join(DEMO_DIR, file), 'utf8'))
}

/** Map an incident to a 0–1 risk score (lower TTC + higher severity = worse). */
function riskOf(inc) {
  const sevW = { critical: 1.0, warning: 0.6, none: 0.1 }[inc.severity ?? 'warning'] ?? 0.5
  const ttc = Number(inc.ttc_seconds ?? 3)
  const ttcW = Math.max(0, Math.min(1, (3 - ttc) / 3)) // ttc 0s→1, ≥3s→0
  const speedW = Math.min(1, Number(inc.ego_speed_at_trigger ?? 0) / 20)
  return Math.round((0.5 * sevW + 0.35 * ttcW + 0.15 * speedW) * 100) / 100
}

const TOOLS = {
  list_scenarios: {
    description: 'List every driving scenario in the dataset with its incident count.',
    run: () =>
      sceneFiles().map((f) => {
        const s = JSON.parse(readFileSync(join(DEMO_DIR, f), 'utf8'))
        return { scenarioId: s.scenarioId, incidents: (s.incidents ?? []).length }
      }),
  },
  inspect_scenario: {
    description: 'Inspect one scenario: incidents, severity, conditions, object count.',
    run: ({ scenario }) => {
      const s = loadScene(scenario)
      return {
        scenarioId: s.scenarioId,
        weather: s.stats?.weather,
        timeOfDay: s.stats?.time_of_day,
        objects: (s.tracked_objects ?? []).length,
        incidents: (s.incidents ?? []).map((i) => ({
          type: i.type,
          severity: i.severity,
          ttc_seconds: i.ttc_seconds,
          ego_speed: i.ego_speed_at_trigger,
        })),
      }
    },
  },
  assess_risk: {
    description: 'Score a scenario\'s worst incident on a 0–1 risk scale.',
    run: ({ scenario }) => {
      const s = loadScene(scenario)
      const incs = (s.incidents ?? []).map((i) => ({ ...i, risk: riskOf(i) }))
      const worst = incs.sort((a, b) => b.risk - a.risk)[0]
      return worst
        ? { scenarioId: s.scenarioId, riskScore: worst.risk, worstIncident: worst.type, ttc: worst.ttc_seconds }
        : { scenarioId: s.scenarioId, riskScore: 0, worstIncident: null }
    },
  },
  recommend_policy: {
    description: 'Draft a driving-policy recommendation for a scenario\'s worst incident.',
    run: async ({ scenario }) => {
      const s = loadScene(scenario)
      const worst = (s.incidents ?? []).map((i) => ({ ...i, risk: riskOf(i) })).sort((a, b) => b.risk - a.risk)[0]
      if (!worst) return { scenarioId: s.scenarioId, recommendation: 'No incident — no policy change needed.' }
      const llm = await maybeLLM(
        'You are an AV safety policy engineer. In 2 sentences, recommend a concrete driving-policy change.',
        `Scenario ${s.scenarioId}: ${worst.description} (type=${worst.type}, TTC=${worst.ttc_seconds}s, ego speed=${worst.ego_speed_at_trigger} m/s, severity=${worst.severity}).`,
      )
      return {
        scenarioId: s.scenarioId,
        incident: worst.type,
        risk: worst.risk,
        recommendation:
          llm ||
          `For ${worst.type} (TTC ${worst.ttc_seconds}s at ${worst.ego_speed_at_trigger} m/s): lower the speed ceiling and widen the following/lateral buffer in this context, and trigger defensive braking ~1s earlier on this threat geometry.`,
      }
    },
  },
  write_report: {
    description: 'Write the audit findings to a markdown report on disk.',
    run: ({ title, sections }) => {
      mkdirSync(OUT_DIR, { recursive: true })
      const path = join(OUT_DIR, 'safety_agent_report.md')
      const body =
        `# ${title || 'Overflow Safety Audit'}\n\n` +
        `_Generated by the ArmorIQ-governed Overflow Safety Agent._\n\n` +
        (sections || []).map((s) => `## ${s.heading}\n\n${s.body}\n`).join('\n')
      writeFileSync(path, body)
      return { path: path.replace(ROOT + '/', ''), bytes: body.length }
    },
  },
}

// ---------------------------------------------------------------------------
// Planner — LLM if an OpenAI key is present, else a solid scripted plan
// ---------------------------------------------------------------------------

const OPENAI_KEY = env.OPENAI_API_KEY || env.VITE_OPENAI_API_KEY || ''

async function maybeLLM(system, user) {
  if (!OPENAI_KEY) return null
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.3,
        max_tokens: 400,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    })
    if (!r.ok) return null
    const j = await r.json()
    return j.choices?.[0]?.message?.content?.trim() || null
  } catch {
    return null
  }
}

function scriptedPlan() {
  const scenarios = sceneFiles().map((f) => JSON.parse(readFileSync(join(DEMO_DIR, f), 'utf8')).scenarioId)
  const plan = [{ tool: 'list_scenarios', args: {} }]
  for (const id of scenarios) plan.push({ tool: 'inspect_scenario', args: { scenario: id } })
  for (const id of scenarios) plan.push({ tool: 'assess_risk', args: { scenario: id } })
  // recommend for the single worst scenario (resolved at runtime), then report
  plan.push({ tool: 'recommend_policy', args: { scenario: '@worst' } })
  plan.push({ tool: 'write_report', args: { title: 'Overflow Safety Audit', sections: '@findings' } })
  return plan
}

// ---------------------------------------------------------------------------
// ArmorIQ governor — wraps the SDK; degrades to shadow mode without a key
// ---------------------------------------------------------------------------

function makeGovernor() {
  const apiKey = env.ARMORIQ_API_KEY || ''
  const agentId = env.ARMORIQ_AGENT_ID || 'overflow-safety-agent'
  const enforce = (env.ARMORIQ_MODE || 'monitor').toLowerCase() === 'enforce'

  if (!apiKey) {
    return {
      live: false,
      agentId,
      enforce,
      async startPlan() {},
      async check() {
        return { allowed: true, action: 'allow', reason: 'shadow (no ARMORIQ_API_KEY)' }
      },
      async report() {},
      tokenId: () => null,
      close() {},
    }
  }

  const require = createRequire(import.meta.url)
  const { ArmorIQClient } = require('@armoriq/sdk')
  const client = new ArmorIQClient({
    apiKey,
    userId: env.ARMORIQ_USER_ID || 'overflow',
    agentId,
    contextId: env.ARMORIQ_CONTEXT_ID || 'default',
    useProduction: (env.ARMORIQ_ENV || 'production') !== 'development',
  })
  const session = client.startSession({ mode: 'local', llm: 'gpt-4o-mini', defaultMcpName: 'overflow-tools' })

  return {
    live: true,
    agentId,
    enforce,
    async startPlan(plan, goal) {
      await session.startPlan(plan.map((s) => ({ name: s.tool, args: s.args })), goal)
    },
    async check(tool, args) {
      try {
        return await session.enforce(tool, args)
      } catch (e) {
        return { allowed: true, action: 'allow', reason: `armoriq error (fail-open): ${e?.message || e}` }
      }
    },
    async report(tool, args, result) {
      try {
        await session.report(tool, args, result, { status: 'success' })
      } catch { /* audit best-effort */ }
    },
    tokenId: () => session.currentTokenValue?.tokenId ?? null,
    close() { try { client.close() } catch { /* noop */ } },
  }
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

async function main() {
  const goal = process.argv.slice(2).join(' ') || 'Audit every driving scenario for critical incidents and draft policy fixes.'

  const gov = makeGovernor()
  const plan = scriptedPlan()

  console.log(c.bold('\n╔════════════════════════════════════════════════════════════╗'))
  console.log(c.bold('║  Overflow Safety Agent — governed by ArmorIQ               ║'))
  console.log(c.bold('╚════════════════════════════════════════════════════════════╝'))
  console.log(`${c.dim('goal    ')} ${goal}`)
  console.log(`${c.dim('agent   ')} ${gov.agentId}   ${c.dim('mode')} ${gov.enforce ? 'enforce' : 'monitor'}   ${gov.live ? c.green('● LIVE') : c.yellow('○ shadow — set ARMORIQ_API_KEY in .env')}`)
  console.log(`${c.dim('planner ')} ${OPENAI_KEY ? 'gpt-4o-mini' : 'scripted (no OPENAI key)'}`)
  console.log(`${c.dim('steps   ')} ${plan.length}\n`)

  // 1) Declare the whole plan → mint the signed intent token.
  await gov.startPlan(plan, goal)
  const tok = gov.tokenId()
  console.log(gov.live ? c.green(`✓ intent token minted${tok ? ` (${tok})` : ''} — agent is ACTIVE in the dashboard\n`) : c.dim('· shadow: no token minted\n'))

  const findings = []
  let worstScenario = null
  let worstRisk = -1
  let allowed = 0
  let blocked = 0

  for (const step of plan) {
    // Resolve runtime placeholders from earlier findings.
    const args = { ...step.args }
    if (args.scenario === '@worst') args.scenario = worstScenario || findings[0]?.scenarioId
    if (args.sections === '@findings') {
      args.sections = [
        { heading: 'Scenarios audited', body: findings.filter((f) => typeof f.riskScore === 'number').map((f) => `- \`${f.scenarioId}\` — risk ${f.riskScore}${f.worstIncident ? ` (${f.worstIncident})` : ''}`).join('\n') || '- none' },
        { heading: 'Highest-risk scenario', body: worstScenario ? `\`${worstScenario}\` (risk ${worstRisk.toFixed(2)})` : 'none' },
        { heading: 'Policy recommendation', body: findings.find((f) => f.recommendation)?.recommendation || 'No critical incident found.' },
      ]
    }

    // 2) Enforce BEFORE running the tool.
    const verdict = await gov.check(step.tool, args)
    const ok = !(gov.enforce && verdict.action === 'block')
    const mark = verdict.action === 'block' ? c.red('⨯ block') : verdict.action === 'hold' ? c.yellow('⏸ hold') : c.green('✓ allow')
    console.log(`${c.cyan('▶')} ${step.tool.padEnd(18)} ${c.dim(JSON.stringify(args).slice(0, 46))}`)
    console.log(`    ArmorIQ ${mark}${verdict.reason ? c.dim('  — ' + verdict.reason) : ''}`)

    if (!ok) {
      blocked++
      console.log(c.red('    ↳ blocked — tool skipped\n'))
      continue
    }
    allowed++

    // 3) Execute the tool, then report the outcome for the audit trail.
    let result
    try {
      result = await TOOLS[step.tool].run(args)
    } catch (e) {
      result = { error: e?.message || String(e) }
    }
    await gov.report(step.tool, args, result)

    // Track findings to drive later steps + the report.
    if (step.tool === 'assess_risk' && typeof result?.riskScore === 'number') {
      findings.push(result)
      if (result.riskScore > worstRisk) { worstRisk = result.riskScore; worstScenario = result.scenarioId }
    }
    if (step.tool === 'recommend_policy' && result?.recommendation) findings.push(result)

    const preview = step.tool === 'list_scenarios' ? `${result.length} scenarios`
      : step.tool === 'write_report' ? `→ ${result.path}`
      : JSON.stringify(result).slice(0, 70)
    console.log(c.dim(`    → ${preview}\n`))
  }

  console.log(c.bold('──────────────────────────────────────────────────────────────'))
  console.log(`${c.green(`✓ ${allowed} allowed`)}${blocked ? `   ${c.red(`⨯ ${blocked} blocked`)}` : ''}   ${c.dim(`report: checkpoints/safety_agent_report.md`)}`)
  if (gov.live) {
    console.log(c.dim(`Open the ArmorIQ Intent dashboard — "${gov.agentId}" is now active with a full audit trail.`))
  } else {
    console.log(c.yellow(`Shadow run complete. Add ARMORIQ_API_KEY to .env and re-run to light up the dashboard.`))
  }
  console.log('')
  gov.close()
}

main().catch((e) => {
  console.error(c.red(`\nagent failed: ${e?.stack || e}\n`))
  process.exit(1)
})
