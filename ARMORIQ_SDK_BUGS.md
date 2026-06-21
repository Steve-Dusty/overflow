# `@armoriq/sdk` — Bug & Issue Report

**Package:** `@armoriq/sdk@0.3.8` (the version that `npm install @armoriq/sdk` resolved to)
**Reported:** 2026-06-20
**Backend:** production (`iap.armoriq.ai` / `proxy.armoriq.ai` / `api.armoriq.ai`), `ak_live_*` key
**How tested:** the Overflow agent + fleet (`npm run agent`, `npm run fleet`) plus two throwaway probe scripts that exercised every public client method against the live backend. All file:line references are into the installed `node_modules/@armoriq/sdk/dist/`.

> Scope note on accuracy: `npm audit` reports 11 vulnerabilities for this project, but **only one is attributable to this SDK** (see §Security). The other ten are the app's pre-existing dev dependencies (vite, react-router, esbuild, …) and are **not** ArmorIQ's. Likewise, one earlier "bug" we saw turned out to be our own probe passing wrong params — documented under §Not-a-bug so it isn't double-counted.

---

## Summary

| # | Severity | Area | Issue | Workaround |
|---|----------|------|-------|------------|
| 1 | **High** | Plan Assurance | `verifyToken()` returns `true` for a token whose `planHash` was mutated | Don't treat `verifyToken` as tamper-detection; re-check `planHash` yourself |
| 2 | **High** | Delegation | `delegate()` always throws against the live backend (response-shape mismatch) | Use `delegateSubtree()` |
| 3 | **Medium** | Delegation | `createDelegationRequest()` TS type marks `arguments`/`amount` optional, but the backend requires them | Always pass `arguments: {}` and a valid `amount` |
| 4 | **Medium** | DX / logging | 43 unconditional `console.*` calls; no `silent`/`logger` option | Monkey-patch `console` or filter stdout |
| 5 | **Low** | Packaging | Node-only (axios + Node `crypto`, secret key) but nothing stops you importing it client-side | Keep it server-side only |
| 6 | **Low** | Security (deps) | `js-yaml@4.1.1` pulls a moderate DoS advisory | Only hit if you call `fromConfig()`; avoid or override |
| 7 | **Low** | Consistency | unregistered `defaultMcpName` accepted silently; `getMcpToolSchemas` 404s but `resolveRole` succeeds for the same name | Register MCPs before referencing them |
| 8 | **Low** | Logging hygiene | logs the last 8 chars of the secret API key to stdout | n/a (cosmetic, but a log-leak) |

---

## Detailed findings

### 1. `verifyToken()` does not detect a tampered token object — **High**
**What:** `verifyToken()` is the SDK's "Plan Assurance" check, but it returns `true` even when the `IntentToken`'s `planHash` has been replaced with garbage.

**Repro:**
```js
const token = await session.startPlan(plan, goal)
await client.verifyToken(token)                                  // → true   (expected)
await client.verifyToken({ ...token, planHash: 'deadbeef'.repeat(8) })  // → true   ❌
```
**Observed:** `true` for both. **Expected:** the tampered token should fail (or the method's contract should be documented as "validates the signed JWT only, not the client-side object fields").

**Likely root cause:** `verifyToken` forwards `token.jwtToken` to the IAP verify-step endpoint, which validates the *signature + expiry* of the signed JWT. The `planHash` field on the JS object is not part of that signed payload, so mutating it is invisible to the check. That may be "working as intended" server-side — but as a consumer-facing API named `verifyToken(token)`, returning `true` for an object that no longer matches its own signature is **misleading and unsafe to rely on for integrity**. At minimum it needs documenting; ideally it should re-derive and compare `planHash` against the signed payload.

---

### 2. `delegate()` is broken against the live backend — **High**
**What:** the legacy `delegate()` always throws; the parser looks for response keys the backend no longer returns.

**Error:**
```
DelegationException: Delegation response missing 'delegation' key.
Got keys: operation, payload, signer, signature, issued_at, intermediate_cert
```
**Root cause** — `dist/client.js:851-853`:
```js
const delegatedTokenData = data.delegation || data.delegated_token || data.new_token;
if (!delegatedTokenData) {
  throw new DelegationException(`Delegation response missing 'delegation' key. ...`);
}
```
The backend now returns a CSRG signed envelope (`operation/payload/signer/signature/intermediate_cert`) — none of the three keys the SDK checks. So `delegate()` is dead code path against current infra.

**Workaround:** use `delegateSubtree(token, { delegatePublicKey, subtreePath, allowedTools, targetAgent })`, which **works** and returns `{ trustId, delta, inclusionProof, subtreeRoot, delegatedToken }`. (This is what the Overflow fleet uses.)

---

### 3. `createDelegationRequest()` — type says optional, backend says required — **Medium**
**What:** `DelegationRequestParams` (`dist/models.d.ts:226`) marks `arguments?` and `amount?` as optional, but the backend rejects requests that omit them.

**Repro:**
```js
await client.createDelegationRequest({ tool: 'assess_risk', action: 'read', requesterEmail: 'x@y.z' })
```
**Error:**
```
Failed to create delegation request: arguments must be an object, amount must not exceed 10,000,000, amount must …
```
**Root cause:** `createDelegationRequest` (`dist/client.js:1135`) posts `params` straight through with **no client-side validation**, so the TS type is the only contract a consumer sees — and it's wrong (under-specifies required fields). Fix is either the type (`arguments`/`amount` required) or backend (accept defaults).

---

### 4. Unconditional `console.*` logging, no way to silence — **Medium (DX)**
**What:** the SDK prints to stdout on nearly every operation — init, key validation, plan capture, token issuance, client close — with **43 `console.*` call sites** (20 `warn`, 15 `log`, 6 `info`, 2 `error`) and **no `silent`/`verbose`/`logger` option** anywhere in `dist`.

**Evidence** (`dist/client.js`): `:197` init banner, `:470` "✅ API key validated successfully", `:489` "Capturing plan…", `:519` "Plan captured…", `:526` "Requesting intent token…", plus "Token … is valid", "ArmorIQ SDK client closed", etc.

**Impact:** any CLI/app embedding the SDK gets its output polluted (our `npm run fleet` had to `grep -v` the noise). A library should gate logs behind a flag or injectable logger. **Workaround:** wrap/patch `console` around SDK calls, or pipe-filter stdout.

---

### 5. Node-only, but nothing prevents client-side import — **Low**
`engines.node >= 18`; depends on `axios` + Node `crypto` (`delegate*` generates ed25519 keypairs via `node:crypto`) and holds a **secret** `ak_live_*` / `ak_claw_*` key. It must run server-side, but there's no `"browser": false` field, no runtime guard, and the README's quickstart doesn't call it out — easy to footgun the key into a browser bundle. (Overflow runs it only in the Vite middleware + Node scripts for this reason.)

---

### 6. Dependency advisory: `js-yaml@4.1.1` — **Low (Security)**
The **only** `npm audit` advisory attributable to this SDK's dependency subtree:
```
js-yaml  (moderate)  — Quadratic-complexity DoS in merge key handling via repeated aliases
@armoriq/sdk@0.3.8 → js-yaml@4.1.1
```
`js-yaml` is only used by `fromConfig()` (the `armoriq.yaml` loader). If you don't use that path, it's never exercised — but it still ships in the tree. The SDK's other dep, `axios@1.18.0`, is clean. (All other project vulns are unrelated pre-existing devDeps.)

---

### 7. Inconsistent handling of unregistered MCP names — **Low**
`startSession({ defaultMcpName: 'overflow-tools' })` accepts a name with no validation. Later:
- `getMcpToolSchemas('overflow-tools')` → throws `404 MCP server not found: overflow-tools`
- `resolveRole('overflow-tools', 'admin')` → returns `'admin'` (succeeds for the same nonexistent MCP)

Pick one behavior. (Not blocking for local/observe-mode flows, which don't need a real MCP.)

---

### 8. Secret key suffix printed to stdout — **Low**
The init log prints `api_key=***8da0b5cf` — masked, but it's the **last 8 chars of a live secret** echoed to stdout/logs. Combined with #4 (can't disable logging), the suffix lands in any captured log.

---

## What works correctly (for balance)
`capturePlan`, `getIntentToken` (mints signed token, `stepProofs` per step), `startSession`/`startPlan`, `enforce` (returns `{ allowed, action }`), `report`, `updatePlanStatus`, `completePlan`, `revoke` (returns `trustId` + signed `Revoke` delta), `reanchor` (signed `ReAnchor` delta), `listMcps`, `delegateSubtree` — all verified working live.

## Not-a-bug (clarifications, so they aren't miscounted)
- **Earlier `createDelegationRequest` "property userEmail should not exist" error** — that was *our* probe passing `{ userEmail, targetAgent, … }` (wrong field names). The real issue is the narrower one in #3. Corrected here.
- **`getMcpToolSchemas` 404** — expected; we never registered an MCP named `overflow-tools` (we use local/observe mode).
- **The other 10 `npm audit` vulns** (vite, react-router, esbuild, postcss, lodash-es, brace-expansion, flatted, picomatch, launch-editor) — pre-existing app devDeps, not ArmorIQ.

## Reproducing this report
All findings reproduce against `@armoriq/sdk@0.3.8` with a valid `ARMORIQ_API_KEY` in `.env`. The agent/fleet runners (`npm run agent`, `npm run fleet`) exercise the working paths; the throwaway probes used for the method sweep are not committed.
