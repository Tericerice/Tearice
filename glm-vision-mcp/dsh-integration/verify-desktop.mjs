/**
 * Smoke + behavior test for the DSH Desktop app profile.
 * Resolves @deepseek-ai/dsh-app-boot from the desktop app's own node_modules
 * (run with cwd = F:\DSH Desktop\resources\app) and boots the desktop
 * harness's real web profile (cordis.yml + cordis.patch.yml), then drives
 * agent/pre-step + agent/request waterfalls against the real plugin file.
 */
import { boot, loadOptionalPatches } from '@deepseek-ai/dsh-app-boot'
import { join } from 'node:path'

const profileDir = join(process.env['USERPROFILE'], 'AppData', 'Roaming', 'dsh-desktop', 'harness', 'profiles', 'web')
const configPath = join(profileDir, 'cordis.yml')
const patchPath = join(profileDir, 'cordis.patch.yml')
// 只取 vision-auto-router 的 insert 层，跳过需要 agents/tools 服务的其他插件
// （如 dsh-cron），它们不属于本次行为测试的范围。
const patches = loadOptionalPatches('desktop-smoke', patchPath)
  .filter((entry) => Array.isArray(entry?.insert)
    && entry.insert.some((e) => e?.id === 'vision-auto-router'))
console.log('patches parsed:', patches.length, 'layer(s)')

const ctx = await boot('desktop-smoke', configPath, patches)
const entries = [...ctx.loader.entries()]
const router = entries.find((e) => e.options.id === 'vision-auto-router')
console.log('router entry found:', Boolean(router))
console.log('router fiber active:', Boolean(router?.fiber))
console.log('router config:', JSON.stringify(router?.options?.config))

let failures = 0
const check = (name, cond, extra) => {
  if (cond) console.log(`  ok: ${name}`)
  else { failures += 1; console.error(`FAIL: ${name}`, extra ?? '') }
}

const makeAgent = () => ({ id: 'desktop-agent-' + Math.random().toString(36).slice(2) })
const imageMsg = (id) => ({
  id,
  role: 'user',
  content: [{ type: 'image', attachment: { attachmentId: 'sha256:x', mediaType: 'image/png', bytes: 1, width: 1, height: 1 } }],
  source: { kind: 'user' },
})
const textMsg = (id) => ({ id, role: 'user', content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } })

async function runStep(agent, messages) {
  const pre = await ctx.waterfall('agent/pre-step', { agent, messages, turn: 1, step: 0, signal: new AbortController().signal }, async (d) => d)
  if (pre?.kind === 'reject') return { pre }
  const request = await ctx.waterfall('agent/request', { agent, turn: 1, step: 0, signal: new AbortController().signal }, async () => ({
    provider: 'opencode-go',
    model: 'deepseek-v4-flash',
  }))
  return { pre, request }
}

console.log('test 1: image message -> vision model')
{
  const { request } = await runStep(makeAgent(), [imageMsg('m1')])
  check('provider == glm', request?.provider === 'glm', request)
  check('model == glm-4v', request?.model === 'glm-4v', request)
}

console.log('test 2: text message -> default model')
{
  const { request } = await runStep(makeAgent(), [textMsg('m2')])
  check('provider stays opencode-go', request?.provider === 'opencode-go', request)
  check('model stays deepseek-v4-flash', request?.model === 'deepseek-v4-flash', request)
}

console.log('test 3: flag consumed after one step')
{
  const agent = makeAgent()
  const { request: first } = await runStep(agent, [imageMsg('m3a')])
  const { request: second } = await runStep(agent, [textMsg('m3b')])
  check('first step vision', first?.model === 'glm-4v', first)
  check('second step default again', second?.model === 'deepseek-v4-flash', second)
}

await ctx.fiber.dispose()
console.log(failures === 0 ? '\nDESKTOP PROFILE ALL TESTS PASSED' : `\n${failures} TEST(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
