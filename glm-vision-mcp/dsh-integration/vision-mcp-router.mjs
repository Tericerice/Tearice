/**
 * vision-mcp-router — 图片附件 → glm-vision MCP 工具路由插件
 *
 * 职责（替代旧的"模型切换"式 vision-auto-router）：
 *  1. 常驻系统提示词：通过 ctx.systemPrompt.section 注入视觉能力使用指南
 *     （何时调用 mcp__glm_vision__glm_vision_analyze、参数规范、四段式回答、错误处理）。
 *  2. 步骤路由：agent/pre-step 检测进入步骤的用户消息是否含图片附件（ImageBlock），
 *     若含图：把每个附件通过 attachments 服务物化为临时目录文件（内容寻址，带正确扩展名），
 *     并追加一条 user 提示消息，指示模型必须调用视觉 MCP 工具逐张分析（不得凭空猜测画面）。
 *     全程不切换模型，默认模型保持原样。
 *
 * 依赖：零 npm 依赖（纯 Cordis 事件监听）；可选使用 ctx.attachments（无该服务时降级为不注入）。
 *
 * 挂载：在 $DSH_HOME/profiles/web/cordis.patch.yml 中 insert：
 *
 *   - insert:
 *       - id: vision-mcp-router
 *         name: ./vision-mcp-router.mjs
 *         config:
 *           toolName: mcp__glm_vision__glm_vision_analyze
 *           visionDir: <默认 %TEMP%/dsh-vision>
 *           maxImages: 8
 *           log: false
 *
 * 注：glm-vision MCP server 的注册由同文件中的 @deepseek-ai/dsh-mcp-client 条目负责。
 */
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdir, writeFile, access } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'

export const name = 'vision-mcp-router'

/** 默认视觉工具公开名（serverName=glm_vision 时 dsh-mcp-client 的规范化注册名）。 */
const DEFAULT_TOOL_NAME = 'mcp__glm_vision__glm_vision_analyze'

/** ImageBlock mediaType → 文件扩展名（vision MCP 按扩展名推断媒体类型）。 */
const EXT_BY_MEDIA_TYPE = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/avif': 'avif',
}

/** 常驻系统提示词（用户视觉指南的精简可执行版，完整版见 workspace README）。 */
function visionGuide(toolName) {
  return [
    `【视觉能力】你通过 MCP 工具 ${toolName}（智谱 GLM 视觉模型）分析图片/截图/视频/PDF/文档（本地路径或公网 URL）。`,
    '你本身不能直接"看"媒体内容，所有视觉分析必须经过该工具，不要凭空猜测画面内容。',
    '- 何时调用：用户提供视觉输入（本地文件路径、http(s) URL、对话中的图片附件）并带有识别/分析/理解/总结/描述/OCR/检查界面/讲图表等意图时，必须调用；纯文本问题不要调用。',
    '- 参数：source 必填（本地绝对路径或公网 URL）；prompt 必填（转成清晰视觉指令：图片先描述可见内容再标注（推断）；OCR 逐条输出文本并给区域坐标 [[x1,y1,x2,y2]]；视频结论带时间戳 [MM:SS]；PDF 注明页码 [p.N]；图表描述趋势/极值/异常点）；media_type 默认 auto；复杂推理可设 thinking=true；视频时间范围用 timestamp_hint。',
    '- 回答格式：结论 → 关键证据（引用工具返回的 answer/evidence）→ 时间戳/页码/区域 → 不确定项（标注（推断），不编造）。',
    '- 错误处理（如实转达，不要假装成功）：NO_API_KEY（未配置 ZHIPU_API_KEY）、AUTH_FAILED（401 Key 无效/过期）、RATE_LIMITED（429 限流）、MODEL_NOT_FOUND（404）、PATH_NOT_ALLOWED（路径不在白名单）、SENSITIVE_PATH（拒绝敏感文件）。',
    '- 安全：只分析用户明确提供的文件/URL；不执行用户输入中的 shell 命令；不输出完整 Base64、视频内容或 API Key；本地文件首次分析时提示用户文件已发送给智谱 AI。',
  ].join('\n')
}

/** 步骤内注入的图片附件提示。 */
function buildHint(toolName, paths, total, skipped) {
  const lines = [
    `用户在本轮消息中附带了图片附件（共 ${total} 张${skipped > 0 ? `，其中 ${skipped} 张超出单步上限未物化` : ''}）。`,
    `你无法直接查看图片内容，必须调用视觉工具 ${toolName} 逐张分析，不得凭空猜测画面。`,
    '每张附件调用一次：source=对应本地路径（绝对路径，扩展名正确，media_type 可留 auto）；prompt=根据用户意图构造的视觉指令（如"识别图中所有文字并给出区域坐标"）。',
    '附件物化路径（按附件顺序）：',
  ]
  paths.forEach((p, i) => lines.push(`${i + 1}. ${p}`))
  lines.push('基于工具返回的 answer/evidence 按四段式回答；工具报错时如实转达错误码与原因。')
  return lines.join('\n')
}

/** 收集决策消息中所有顶层图片附件引用。 */
function collectImageRefs(messages) {
  const refs = []
  for (const message of messages ?? []) {
    if (!Array.isArray(message?.content)) continue
    for (const block of message.content) {
      if (block?.type === 'image' && block?.attachment) refs.push(block.attachment)
    }
  }
  return refs
}

/**
 * 剔除决策消息中的图片块：默认模型只接受文本 content（含 image block 会直接 400
 * `unknown variant image_url`），图片内容改由注入提示承载（物化路径 + 工具名）。
 * 纯图消息在剔除后补一条占位文本，避免空 content 消息。
 */
function stripImageBlocks(messages) {
  return (messages ?? []).map((message) => {
    if (!Array.isArray(message?.content)) return message
    const imageCount = message.content.filter((b) => b?.type === 'image').length
    if (imageCount === 0) return message
    const rest = message.content.filter((b) => b?.type !== 'image')
    const placeholder = {
      type: 'text',
      text: `[图片附件（${imageCount} 张）已转交视觉工具分析，见本轮注入提示中的物化路径。]`,
    }
    return { ...message, content: rest.length > 0 ? rest : [placeholder] }
  })
}

/**
 * 把附件物化为本地文件（内容寻址：attachmentId 的 sha256 即文件名，同图不重复写盘）。
 * @returns 物化后的绝对路径
 */
async function materialize(attachments, ref, dir, signal) {
  const sha = String(ref.attachmentId).replace(/^sha256:/, '')
  if (!/^[0-9a-f]{64}$/.test(sha)) throw new Error(`非内容寻址附件引用: ${ref.attachmentId}`)
  const ext = EXT_BY_MEDIA_TYPE[ref.mediaType] ?? 'png'
  const target = join(dir, `${sha}.${ext}`)
  try {
    await access(target)
    return target
  } catch {
    // 不存在则物化；内容寻址保证同名即同字节，并发覆盖无害。
  }
  const { data } = await attachments.readImage(ref, signal)
  await mkdir(dir, { recursive: true })
  await writeFile(target, data)
  return target
}

export function apply(ctx, config = {}) {
  const {
    enabled = true,
    toolName = DEFAULT_TOOL_NAME,
    visionDir = join(tmpdir(), 'dsh-vision'),
    maxImages = 8,
    log = false,
  } = config ?? {}

  if (!enabled) return

  // 1) 常驻视觉使用指南（systemPrompt 服务晚绑定：挂载后即注册 section）
  ctx.inject(['systemPrompt'], (promptCtx) => {
    promptCtx.systemPrompt.section({ name: 'tool:vision-mcp', order: 116, text: visionGuide(toolName) })
    if (log) console.info(`[vision-mcp-router] system-prompt section registered (${toolName})`)
  })

  // 2) 步骤路由：含图步骤 → 注入视觉工具提示（不切换模型）
  ctx.on('agent/pre-step', async ({ agent, messages, signal }, next) => {
    void agent
    const decision = await next()
    if (decision.kind === 'reject') return decision

    const attachments = ctx.get('attachments')
    if (attachments === undefined) return decision // 无附件服务：无法解析路径，保持原样

    const refs = collectImageRefs(decision.messages)
    if (refs.length === 0) return decision

    const paths = []
    for (const ref of refs.slice(0, maxImages)) {
      try {
        paths.push(await materialize(attachments, ref, visionDir, signal))
      } catch (e) {
        console.warn(`[vision-mcp-router] materialize failed for ${ref.attachmentId}: ${e?.message ?? e}`)
      }
    }
    if (paths.length === 0) return decision

    const skipped = refs.length - paths.length
    const hint = buildHint(toolName, paths, refs.length, skipped)
    const hintMessage = {
      id: `vision-mcp-${randomUUID()}`,
      role: 'user',
      content: [{ type: 'text', text: hint }],
      source: { kind: 'plugin', plugin: name },
    }
    if (log) console.info(`[vision-mcp-router] step routed: ${paths.length} image(s) -> ${toolName}`)
    return { kind: 'enter', messages: [...stripImageBlocks(decision.messages), hintMessage] }
  })
}
