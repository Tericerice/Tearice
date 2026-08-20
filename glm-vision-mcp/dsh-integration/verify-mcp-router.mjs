/**
 * verify-mcp-router.mjs — 验证 glm-vision MCP 接入与路由（两阶段）
 *
 * Phase 1（真实 web profile base 层 + 用户 patch boot）：
 *   1. vision-mcp-router 与 glm-vision-mcp 条目被 Loader 激活
 *   2. mcp__glm_vision__glm_vision_analyze 注册进 ctx.tools（等连接 + 工具发现）
 *   3. systemPrompt 含 tool:vision-mcp section
 * Phase 2（裸 boot + stub attachments）：含图步骤 pre-step 注入提示消息、
 *   附件物化到临时文件、原图块保留、不切换模型。
 *
 * 用法（需在 profile 目录解析 @deepseek-ai/dsh-app-boot）：
 *   cd %USERPROFILE%\.dsh\profiles
 *   node .\verify-mcp-router.mjs
 */
import { boot, loadProfile, loadOptionalPatches } from '@deepseek-ai/dsh-app-boot'
import { join, dirname } from 'node:path'
import { existsSync, mkdtempSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const PLUGIN_PATH = join(here, 'web', 'vision-mcp-router.mjs')
const TOOL = 'mcp__glm_vision__glm_vision_analyze'
const PNG_1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

let failures = 0
const check = (name, cond, extra) => {
  if (cond) console.log(`  ok: ${name}`)
  else { failures += 1; console.error(`FAIL: ${name}`, extra ?? '') }
}

// ================= Phase 1: 真实 profile（base 层，跳过 web-app 避免端口冲突） =================
console.log('== Phase 1: real profile boot (base layer + user patch) ==')
{
  const home = join(process.env['USERPROFILE'], '.dsh')
  const installAnchor = join(home, 'profiles', 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
  const profile = loadProfile('verify-mcp', 'web', installAnchor, home)
  const baseLayer = profile.layers.find((l) => l.packageName === '@deepseek-ai/dsh-base')
  const allPatches = [...(baseLayer?.patches ?? []), ...profile.patches]
  const ctx = await boot('verify-mcp', join(profile.dir, 'cordis.yml'), allPatches)

  const entries = [...ctx.loader.entries()]
  const router = entries.find((e) => e.options.id === 'vision-mcp-router')
  const mcp = entries.find((e) => e.options.id === 'glm-vision-mcp')
  check('vision-mcp-router entry active', Boolean(router?.fiber))
  check('glm-vision-mcp entry active', Boolean(mcp?.fiber))
  console.log('router config:', JSON.stringify(router?.options?.config))

  let tool = undefined
  for (let i = 0; i < 60 && tool === undefined; i++) {
    tool = ctx.get('tools')?.get(TOOL)
    if (tool === undefined) await new Promise((r) => setTimeout(r, 500))
  }
  check(`tool ${TOOL} registered`, Boolean(tool), '未在 30s 内注册')
  if (tool) {
    check('tool schema has source/prompt required', Boolean(
      tool.parameters?.required?.includes('source') && tool.parameters?.required?.includes('prompt'),
    ), tool.parameters?.required)
  }

  try {
    const systemPrompt = ctx.get('systemPrompt')
    if (systemPrompt) {
      const assembly = await systemPrompt.assemble()
      const names = assembly.sections.map((s) => s.name)
      check('systemPrompt has tool:vision-mcp section', names.includes('tool:vision-mcp'), names.join(', '))
    } else {
      check('systemPrompt has tool:vision-mcp section', false, 'systemPrompt service missing')
    }
  } catch (e) {
    check('systemPrompt has tool:vision-mcp section', false, String(e?.message ?? e))
  }
  // 测试环境无真实 session store：不 await dispose（会触发 session flush 噪音）。
}

// ================= Phase 2: 裸 boot + stub attachments 验证注入行为 =================
console.log('== Phase 2: bare boot, pre-step routing behavior ==')
{
  const dir = mkdtempSync(join(tmpdir(), 'vision-mcp-router-test-'))
  mkdirSync(join(dir, 'cfg'), { recursive: true })
  copyFileSync(PLUGIN_PATH, join(dir, 'vision-mcp-router.mjs'))
  writeFileSync(join(dir, 'cfg', 'cordis.yml'), [
    '- id: vision-mcp-router',
    '  name: ../vision-mcp-router.mjs',
    '  config:',
    `    toolName: ${TOOL}`,
    '    log: false',
    '',
  ].join('\n'))
  const ctx = await boot('verify-mcp-bare', join(dir, 'cfg', 'cordis.yml'))

  // stub attachments（真实运行时由 attachment-local 提供；此处只验证路由逻辑）
  ctx.provide('attachments', {
    readImage: async (ref) => ({ ref, data: new Uint8Array(PNG_1x1) }),
  })

  const imageMsg = {
    id: 'verify-img', role: 'user',
    content: [{ type: 'image', attachment: { attachmentId: 'sha256:' + 'a'.repeat(64), mediaType: 'image/png', bytes: PNG_1x1.length, width: 1, height: 1 } }],
    source: { kind: 'user' },
  }
  const textMsg = {
    id: 'verify-txt', role: 'user',
    content: [{ type: 'text', text: '纯文本，不应触发路由' }],
    source: { kind: 'user' },
  }
  const agent = { id: 'verify-agent' }

  const decision = await ctx.waterfall('agent/pre-step',
    { agent, messages: [imageMsg], turn: 1, step: 1, signal: new AbortController().signal },
    async (d) => d,
  )
  check('decision kind enter', decision?.kind === 'enter', decision)
  const msgs = decision?.messages ?? []
  const hint = msgs.find((m) => m.source?.kind === 'plugin' && m.source?.plugin === 'vision-mcp-router')
  check('hint message appended', Boolean(hint))
  if (hint) {
    const text = hint.content.map((b) => b.text ?? '').join('')
    check('hint mentions tool name', text.includes(TOOL), text.slice(0, 120))
    const pathMatch = /([A-Za-z]:[^\n]+\.(?:png|jpg|jpeg|gif|webp|bmp|avif))/.exec(text)
    check('hint carries materialized path', Boolean(pathMatch), text)
    if (pathMatch) {
      check('materialized file exists', existsSync(pathMatch[1]), pathMatch[1])
      console.log('  materialized:', pathMatch[1])
    }
  }
  const original = msgs.find((m) => m.id === 'verify-img')
  check('original image block preserved', Boolean(original?.content?.some((b) => b.type === 'image')))

  // 纯文本步骤：不注入 hint，原样返回
  const textDecision = await ctx.waterfall('agent/pre-step',
    { agent, messages: [textMsg], turn: 1, step: 2, signal: new AbortController().signal },
    async (d) => d,
  )
  const textHint = (textDecision?.messages ?? []).find((m) => m.source?.kind === 'plugin' && m.source?.plugin === 'vision-mcp-router')
  check('text-only step: no hint injected', textHint === undefined)

  // 无附件服务时：不注入也不抛错（降级安全）
  const ctx2 = await boot('verify-mcp-bare2', join(dir, 'cfg', 'cordis.yml'))
  let degraded
  try {
    degraded = await ctx2.waterfall('agent/pre-step',
      { agent, messages: [imageMsg], turn: 1, step: 1, signal: new AbortController().signal },
      async (d) => d,
    )
  } catch (e) {
    degraded = { threw: String(e?.message ?? e) }
  }
  console.log('  degraded decision:', JSON.stringify(degraded)?.slice(0, 200))
  check('no attachments service: decision unchanged', (degraded?.messages?.length ?? 0) === 1)
}

console.log(failures === 0 ? '\nMCP ROUTER VERIFY ALL PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
