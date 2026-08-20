/**
 * E2E: GLM vision routing on the DSH Desktop bundled runtime.
 * Boots the base bundle + user patch layer, verifies:
 *  1. vision-auto-router entry active
 *  2. glm provider registered with glm-4v (input includes image)
 *  3. prepareCall(glm, glm-4v) succeeds
 *  4. image step routes to glm/glm-4v; text step stays default
 * Run with cwd = F:\DSH Desktop\resources\app
 */
import { boot, loadProfile } from '@deepseek-ai/dsh-app-boot'
import { join } from 'node:path'

const home = join(process.env['USERPROFILE'], 'AppData', 'Roaming', 'dsh-desktop', 'harness')
const installAnchor = join(process.cwd(), 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
const profile = loadProfile('e2e', 'web', installAnchor, home)
const baseLayer = profile.layers.find((l) => l.packageName === '@deepseek-ai/dsh-base')
const allPatches = [...(baseLayer?.patches ?? []), ...profile.patches]

const ctx = await boot('e2e', join(profile.dir, 'cordis.yml'), allPatches)
let failures = 0
const check = (name, cond, extra) => {
  if (cond) console.log(`  ok: ${name}`)
  else { failures += 1; console.error(`FAIL: ${name}`, extra ?? '') }
}

const router = [...ctx.loader.entries()].find((e) => e.options.id === 'vision-auto-router')
check('router entry active', Boolean(router?.fiber))
console.log('router config:', JSON.stringify(router?.options?.config))

const llm = ctx.get('llm')
check('llm service present', Boolean(llm))
if (llm) {
  const providers = llm.listProviders().map((p) => p.id)
  check('glm provider registered', providers.includes('glm'), providers)
  const models = await llm.listModels('glm')
  const glm4v = models.find((m) => m.id === 'glm-4v')
  check('glm-4v listed', Boolean(glm4v), models.map((m) => m.id))
  check('glm-4v input includes image', glm4v?.inputModalities?.includes('image'), glm4v)
  try {
    const prepared = await llm.prepareCall({ provider: 'glm', model: 'glm-4v' })
    check('prepareCall(glm, glm-4v) succeeds', Boolean(prepared?.config), prepared?.config)
  } catch (e) {
    check('prepareCall(glm, glm-4v) succeeds', false, String(e?.message ?? e))
  }
}

const imageMsg = {
  id: 'e2e-img', role: 'user',
  content: [{ type: 'image', attachment: { attachmentId: 'sha256:e2e', mediaType: 'image/png', bytes: 1, width: 1, height: 1 } }],
  source: { kind: 'user' },
}
const textMsg = { id: 'e2e-txt', role: 'user', content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } }
const agent = { id: 'e2e-agent' }
await ctx.waterfall('agent/pre-step', { agent, messages: [imageMsg], turn: 1, step: 0, signal: new AbortController().signal }, async (d) => d)
const req = await ctx.waterfall('agent/request', { agent, turn: 1, step: 0, signal: new AbortController().signal }, async () => ({
  provider: 'opencode-go', model: 'deepseek-v4-flash',
}))
check('image step routed to glm', req?.provider === 'glm', req)
check('image step routed to glm-4v', req?.model === 'glm-4v', req)

await ctx.waterfall('agent/pre-step', { agent, messages: [textMsg], turn: 1, step: 1, signal: new AbortController().signal }, async (d) => d)
const req2 = await ctx.waterfall('agent/request', { agent, turn: 1, step: 1, signal: new AbortController().signal }, async () => ({
  provider: 'opencode-go', model: 'deepseek-v4-flash',
}))
check('text step keeps default', req2?.provider === 'opencode-go' && req2?.model === 'deepseek-v4-flash', req2)

console.log(failures === 0 ? '\nGLM E2E ALL PASSED' : `\n${failures} FAILED`)
// 不 await dispose：测试环境无真实 session store，dispose 会触发 session flush 噪音。
process.exit(failures === 0 ? 0 : 1)
