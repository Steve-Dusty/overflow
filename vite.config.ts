import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import type { Plugin } from 'vite'
import fs from 'fs'
import path from 'path'

/**
 * Vite plugin to serve .parquet files with HTTP Range Request support.
 * hyparquet needs byte-range reads for large files (165 MB+ lidar data).
 */
function parquetRangePlugin(): Plugin {
  return {
    name: 'parquet-range-support',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.endsWith('.parquet')) return next()

        const filePath = path.join(process.cwd(), 'public', decodeURIComponent(req.url))
        if (!fs.existsSync(filePath)) return next()

        const stat = fs.statSync(filePath)
        const total = stat.size

        // Set Accept-Ranges header
        res.setHeader('Accept-Ranges', 'bytes')
        res.setHeader('Content-Type', 'application/octet-stream')
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length')

        const rangeHeader = req.headers.range
        if (rangeHeader) {
          const match = rangeHeader.match(/bytes=(\d+)-(\d*)/)
          if (match) {
            const start = parseInt(match[1], 10)
            const end = match[2] ? parseInt(match[2], 10) : total - 1
            const chunkSize = end - start + 1

            res.writeHead(206, {
              'Content-Range': `bytes ${start}-${end}/${total}`,
              'Content-Length': chunkSize,
            })
            fs.createReadStream(filePath, { start, end }).pipe(res)
            return
          }
        }

        // No Range header — serve full file
        res.setHeader('Content-Length', total)
        res.writeHead(200)
        fs.createReadStream(filePath).pipe(res)
      })
    },
  }
}

/**
 * Vite middleware exposing ArmorIQ intent verification at /api/armoriq/*.
 *
 * The ArmorIQ SDK (`@armoriq/sdk`) is server-side and holds a SECRET api key,
 * so it must never reach the browser bundle — all enforcement runs here, in the
 * dev server's Node process. The browser (src/lib/armoriq.ts) only POSTs a
 * proposed ego maneuver and receives a verdict. Each authorize call runs the
 * canonical ArmorIQ flow: startPlan (mints a signed intent token → the agent
 * goes "active" in the Intent dashboard) → enforce (allow/block/hold) → report
 * (audit). Dormant (decision:"off", allow-all) until ARMORIQ_API_KEY is set.
 */
function armoriqProxyPlugin(env: Record<string, string>): Plugin {
  const apiKey = env.ARMORIQ_API_KEY || ''
  const agentId = env.ARMORIQ_AGENT_ID || 'overflow-ego-policy'
  const userId = env.ARMORIQ_USER_ID || 'overflow'
  const contextId = env.ARMORIQ_CONTEXT_ID || 'default'
  // App-level posture: "monitor" observes only; "enforce" lets a block stand.
  const mode = (env.ARMORIQ_MODE || 'monitor').toLowerCase() === 'enforce' ? 'enforce' : 'monitor'
  const configured = apiKey.length > 0

  let session: any = null
  let initError: string | null = null

  async function ensureSession(): Promise<any> {
    if (session || initError) return session
    try {
      const mod: any = await import('@armoriq/sdk')
      const client = new mod.ArmorIQClient({
        apiKey, userId, agentId, contextId,
        useProduction: (env.ARMORIQ_ENV || 'production') !== 'development',
      })
      // 'local' = observe mode: enforce against the signed token locally while
      // we execute the maneuver ourselves (we are the actuator, not an MCP).
      session = client.startSession({ mode: 'local', defaultMcpName: 'av-control', llm: 'openenv-policy' })
    } catch (e) {
      initError = e instanceof Error ? e.message : String(e)
    }
    return session
  }

  const readJson = (req: any): Promise<any> =>
    new Promise((resolve) => {
      let data = ''
      req.on('data', (c: any) => (data += c))
      req.on('end', () => { try { resolve(JSON.parse(data || '{}')) } catch { resolve({}) } })
      req.on('error', () => resolve({}))
    })

  const send = (res: any, status: number, body: unknown): void => {
    res.statusCode = status
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(body))
  }

  return {
    name: 'armoriq-intent-proxy',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/armoriq/')) return next()

        // Status probe — lets the UI decide whether to show the verdict badge.
        if (req.url.startsWith('/api/armoriq/status')) {
          return send(res, 200, { configured, allowed: true, decision: configured ? 'allow' : 'off', mode, agentId })
        }
        if (!req.url.startsWith('/api/armoriq/authorize')) return next()

        // Dormant — no key configured. Allow-all, exactly as before ArmorIQ.
        if (!configured) return send(res, 200, { configured: false, allowed: true, decision: 'off' })

        const intent = await readJson(req)
        const args = {
          action: intent.action,
          scenario: intent.scenarioId,
          frame: intent.frameIndex,
          ego_speed: intent.egoSpeed,
          nearest_object_m: intent.nearestObjectDist,
        }

        try {
          const s = await ensureSession()
          if (!s) return send(res, 200, { configured: true, allowed: true, decision: 'off', mode, reason: `armoriq init failed: ${initError}` })

          // 1) Declare intent → signed token (agent goes ACTIVE in dashboard).
          await s.startPlan([{ name: 'ego_maneuver', args }], `Operate ego vehicle safely in ${intent.scenarioId}`)
          // 2) Enforce the maneuver against the signed plan + policy.
          const decision = await s.enforce('ego_maneuver', args)
          // 3) Audit, fire-and-forget — reporting must never add ego latency.
          const allowed = mode === 'enforce' ? !!decision.allowed : true
          Promise.resolve(s.report('ego_maneuver', args, { applied: allowed }, { status: 'success' })).catch(() => {})

          return send(res, 200, {
            configured: true,
            allowed,
            decision: decision.action,           // 'allow' | 'block' | 'hold'
            mode,
            reason: decision.reason,
            matchedPolicy: decision.matchedPolicy,
            tokenId: s.currentTokenValue?.tokenId,
          })
        } catch (e) {
          // Fail OPEN — an ArmorIQ outage must never stall the simulator.
          return send(res, 200, { configured: true, allowed: true, decision: 'off', mode, reason: `armoriq error: ${e instanceof Error ? e.message : String(e)}` })
        }
      })
    },
  }
}

/**
 * Send the `Document-Policy: js-profiling` header so Sentry's browser profiling
 * (JS Self-Profiling API) can actually collect samples on the document in dev.
 */
function jsProfilingHeaderPlugin(): Plugin {
  return {
    name: 'js-profiling-header',
    configureServer(server) {
      server.middlewares.use((_req, res, next) => {
        res.setHeader('Document-Policy', 'js-profiling')
        next()
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  // Load all env (including non-VITE_ vars like SENTRY_*) for build-time use.
  const env = loadEnv(mode, process.cwd(), '')

  // Only upload source maps when fully configured; until then the plugin is
  // omitted, so `vite build` works with just the auth token present.
  const sentryConfigured = Boolean(
    env.SENTRY_AUTH_TOKEN && env.SENTRY_ORG && env.SENTRY_PROJECT,
  )

  return {
    // Emit hidden source maps (uploaded to Sentry, not referenced in the shipped
    // bundle) so production stack traces symbolicate without exposing source.
    build: { sourcemap: 'hidden' },
    plugins: [
      react(),
      parquetRangePlugin(),
      jsProfilingHeaderPlugin(),
      armoriqProxyPlugin(env),
      sentryConfigured &&
        sentryVitePlugin({
          org: env.SENTRY_ORG,
          project: env.SENTRY_PROJECT,
          authToken: env.SENTRY_AUTH_TOKEN,
          sourcemaps: { filesToDeleteAfterUpload: ['./dist/**/*.map'] },
        }),
    ],
  }
})
