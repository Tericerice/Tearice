/**
 * End-to-end test on the DSH Desktop bundled runtime:
 * boots the REAL desktop web profile (bundles + patch + settings), verifies
 * the vision-auto-router plugin routes image requests to
 * omni/gemini/gemini-3.5-flash, and that the pi-ai adapter's model catalog
 * now resolves that model WITH image input modality (no UNKNOWN_MODEL /
 * UNSUPPORTED_CONTENT at resolve time).
 *
 * Run with cwd = F:\DSH Desktop\resources\app so @deepseek-ai/* resolves
 * from the desktop app's own node_modules.
 */
import { boot, loadProfile } from '@deepseek-ai/dsh-app-boot'
import { join } from 'node:path'

const home = join(process.env['USERPROFILE'], 'AppData', 'Roaming', 'dsh-desktop', 'harness')
const installAnchor = join(process.cwd(), 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
const profile = loadProfile('e2e', 'web', installAnchor, home)
// Boot only the base bundle layer + the user patch layer: enough to get the
// llm / llm-pi-ai / settings services without the web-server runtime chain.
const baseLayer = profile.layers.find((l) => l.packageName === '@deepseek-ai/dsh-base')
const allPatches = [...(baseLayer?.patches ?? []), ...profile.patches]
console.log('bundle layers:', profile.layers.map((l) => l.packageName).join(', '))
console.log('using base bundle patches + user layer:', allPatches.length, 'layer(s) total')

const ctx = await boot('e2e', join(profile.dir, 'cordis.yml'), allPatches)
let failures = 0
const check = (name, cond, extra) => {
  if (cond) console.log(`  ok: ${name}`)
  else { failures += 1; console.error(`FAIL: ${name}`, extra ?? '') }
}

// 1. Router entry active
const router = [...ctx.loader.entries()].find((e) => e.options.id === 'vision-auto-router')
check('router entry active', Boolean(router?.fiber))

// 2. LLM service present; omni route resolves the gemini model with image input
const llm = ctx.get('llm')
check('llm service present', Boolean(llm))
if (llm) {
  const providers = llm.listProviders().map((p) => p.id)
  check('omni provider registered', providers.includes('omni'), providers)
  const models = await llm.listModels('omni')
  const gemini = models.find((m) => m.id === 'gemini/gemini-3.5-flash')
  check('gemini/gemini-3.5-flash listed under omni', Boolean(gemini), models.map((m) => m.id))
  check('gemini input includes image', gemini?.inputModalities?.includes('image'), gemini)
  if (gemini) {
    const resolved = await llm.resolveModelInfo('omni', 'gemini/gemini-3.5-flash')
    check('resolveModelInfo ok', resolved.model === 'gemini/gemini-3.5-flash', resolved)
  }
  // 3. prepareCall must NOT throw (adapter can serve this route)
  try {
    const prepared = await llm.prepareCall({ provider: 'omni', model: 'gemini/gemini-3.5-flash' })
    check('prepareCall(omni, gemini) succeeds', Boolean(prepared?.config), prepared?.config)
  } catch (e) {
    check('prepareCall(omni, gemini) succeeds', false, String(e?.message ?? e))
  }
}

// 4. Router waterfall behavior on the live booted tree
const imageMsg = {
  id: 'e2e-img', role: 'user',
  content: [{ type: 'image', attachment: { attachmentId: 'sha256:e2e', mediaType: 'image/png', bytes: 1, width: 1, height: 1 } }],
  source: { kind: 'user' },
}
const textMsg = { id: 'e2e-txt', role: 'user', content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } }
const agent = { id: 'e2e-agent' }
const pre = await ctx.waterfall('agent/pre-step', { agent, messages: [imageMsg], turn: 1, step: 0, signal: new AbortController().signal }, async (d) => d)
void pre
const req = await ctx.waterfall('agent/request', { agent, turn: 1, step: 0, signal: new AbortController().signal }, async () => ({
  provider: 'opencode-go', model: 'deepseek-v4-flash',
}))
check('image step routed to omni', req?.provider === 'omni', req)
check('image step routed to gemini model', req?.model === 'gemini/gemini-3.5-flash', req)

const pre2 = await ctx.waterfall('agent/pre-step', { agent, messages: [textMsg], turn: 1, step: 1, signal: new AbortController().signal }, async (d) => d)
void pre2
const req2 = await ctx.waterfall('agent/request', { agent, turn: 1, step: 1, signal: new AbortController().signal }, async () => ({
  provider: 'opencode-go', model: 'deepseek-v4-flash',
}))
check('text step keeps default', req2?.provider === 'opencode-go' && req2?.model === 'deepseek-v4-flash', req2)

await ctx.fiber.dispose()
console.log(failures === 0 ? '\nE2E ALL PASSED' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
