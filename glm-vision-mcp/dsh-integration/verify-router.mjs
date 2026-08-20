/**
 * Verification script: boots the vision-auto-router plugin with the real
 * Loader and drives the agent/pre-step + agent/request waterfalls to prove
 * image-bearing steps route to the vision model, and text-only steps don't.
 *
 * Usage: node verify-router.mjs
 */
import { boot } from '@deepseek-ai/dsh-app-boot'
import { mkdtempSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pluginSrc = process.env['PLUGIN_PATH'] ?? join(here, 'vision-auto-router.mjs')

const dir = mkdtempSync(join(tmpdir(), 'vision-router-test-'))
mkdirSync(join(dir, 'cfg'), { recursive: true })
copyFileSync(pluginSrc, join(dir, 'vision-auto-router.mjs'))

writeFileSync(join(dir, 'cfg', 'cordis.yml'), [
  '- id: vision-auto-router',
  '  name: ../vision-auto-router.mjs',
  '  config:',
  '    provider: omni',
  '    model: gemini/gemini-3.5-flash',
  '    log: true',
  '',
].join('\n'))

const ctx = await boot('verify', join(dir, 'cfg', 'cordis.yml'))

// Minimal fake agent objects; scope filtering admits untagged listeners,
// so the plugin's global listeners fire for any agent subject.
const agents = []
const makeAgent = (id) => {
  const agent = { id }
  agents.push(agent)
  return agent
}

// Dispatch helper mirroring the loop: agent/pre-step (waterfall), then agent/request (waterfall).
async function runStep(agent, messages) {
  const pre = await ctx.waterfall('agent/pre-step', { agent, messages, turn: 1, step: 0, signal: new AbortController().signal }, async (d) => d)
  if (pre?.kind === 'reject') return { pre }
  const request = await ctx.waterfall('agent/request', { agent, turn: 1, step: 0, signal: new AbortController().signal }, async () => ({
    provider: 'opencode-go',
    model: 'deepseek-v4-flash',
  }))
  return { pre, request }
}

let failures = 0
const check = (name, cond, extra) => {
  if (cond) console.log(`  ok: ${name}`)
  else { failures += 1; console.error(`FAIL: ${name}`, extra ?? '') }
}

console.log('test 1: image-bearing message routes to vision model')
{
  const agent = makeAgent('a1')
  const { request } = await runStep(agent, [{
    id: 'm1',
    role: 'user',
    content: [{ type: 'image', attachment: { attachmentId: 'sha256:x', mediaType: 'image/png', bytes: 1, width: 1, height: 1 } }],
    source: { kind: 'user' },
  }])
  check('provider == omni', request?.provider === 'omni', request)
  check('model == gemini/gemini-3.5-flash', request?.model === 'gemini/gemini-3.5-flash', request)
}

console.log('test 2: text-only message keeps default model')
{
  const agent = makeAgent('a2')
  const { request } = await runStep(agent, [{
    id: 'm2',
    role: 'user',
    content: [{ type: 'text', text: 'hello' }],
    source: { kind: 'user' },
  }])
  check('provider stays opencode-go', request?.provider === 'opencode-go', request)
  check('model stays deepseek-v4-flash', request?.model === 'deepseek-v4-flash', request)
}

console.log('test 3: image flag is consumed after one request (next step back to default)')
{
  const agent = makeAgent('a3')
  const { request: first } = await runStep(agent, [{
    id: 'm3a',
    role: 'user',
    content: [{ type: 'image', attachment: { attachmentId: 'sha256:y', mediaType: 'image/png', bytes: 1, width: 1, height: 1 } }],
    source: { kind: 'user' },
  }])
  const { request: second } = await runStep(agent, [{
    id: 'm3b',
    role: 'user',
    content: [{ type: 'text', text: 'follow-up' }],
    source: { kind: 'user' },
  }])
  check('first request vision', first?.model === 'gemini/gemini-3.5-flash', first)
  check('second request default again', second?.model === 'deepseek-v4-flash', second)
}

console.log('test 4: reasoningEffort dropped when switching (no invalid effort for vision model)')
{
  const agent = makeAgent('a4')
  const pre = await ctx.waterfall('agent/pre-step', { agent, messages: [{ id: 'm4', role: 'user', content: [{ type: 'image', attachment: { attachmentId: 'sha256:z', mediaType: 'image/png', bytes: 1, width: 1, height: 1 } }], source: { kind: 'user' } }], turn: 1, step: 0, signal: new AbortController().signal }, async (d) => d)
  void pre
  const request = await ctx.waterfall('agent/request', { agent, turn: 1, step: 0, signal: new AbortController().signal }, async () => ({
    provider: 'opencode-go',
    model: 'deepseek-v4-flash',
    reasoningEffort: 'high',
    temperature: 0.7,
  }))
  check('reasoningEffort dropped', request?.reasoningEffort === undefined, request)
  check('temperature preserved', request?.temperature === 0.7, request)
}

await ctx.fiber.dispose()
console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} TEST(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
