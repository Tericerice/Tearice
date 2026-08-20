/**
 * vision-auto-router — 图片自动路由插件
 *
 * 当用户消息中包含图片（ImageBlock）时，自动把该轮模型请求路由到
 * 视觉模型（默认智谱 GLM 的 glm-4v）；
 * 无图请求保持原模型不变，仅含图的那一步切换，下一步自动切回。
 *
 * 挂载方式：在 $DSH_HOME/profiles/web/cordis.patch.yml 中 insert：
 *
 *   - insert:
 *       - id: vision-auto-router
 *         name: ./vision-auto-router.mjs
 *         config:
 *           provider: glm
 *           model: glm-4v
 *
 * 依赖：无（纯 Cordis 事件监听，零 npm 依赖，无需构建）。
 */

/** 默认视觉路由（可被 config 覆盖）。 */
const DEFAULT_PROVIDER = 'glm'
const DEFAULT_MODEL = 'glm-4v'

export const name = 'vision-auto-router'

/** 是否需要任何服务注入（不需要）。 */
export const inject = []

/**
 * 插件入口。
 * @param ctx - Cordis 上下文（宿主平面，全局生效，覆盖所有会话）。
 * @param config - 可选配置：{ enabled, provider, model, log }。
 */
export function apply(ctx, config = {}) {
  const {
    enabled = true,
    provider = DEFAULT_PROVIDER,
    model = DEFAULT_MODEL,
    log = false,
  } = config ?? {}

  if (!enabled) return

  // 每个 agent 当前步骤是否包含图片的标记。
  // 在 agent/pre-step 设置（该步骤进入的消息里有 image 块），
  // 在 agent/request 消费并清除（只影响当前这一步）。
  const imageFlag = new WeakMap()

  // 步骤进入前：检查将要进入本步骤的消息是否携带图片。
  ctx.on('agent/pre-step', async ({ agent, messages }, next) => {
    const hasImage = Array.isArray(messages)
      && messages.some((m) => Array.isArray(m?.content)
        && m.content.some((block) => block?.type === 'image'))
    if (hasImage) imageFlag.set(agent, true)
    return next()
  })

  // 模型请求前：若本步骤含图，则切换到视觉模型；否则保持原配置。
  ctx.on('agent/request', async ({ agent }, next) => {
    const resolved = await next()
    if (!imageFlag.get(agent)) return resolved
    imageFlag.delete(agent)

    if (log) {
      console.info(`[vision-auto-router] image detected: routing ${resolved.provider}/${resolved.model} -> ${provider}/${model}`)
    }
    // 切换 provider/model 时丢弃继承的推理强度（属于原模型），
    // 让视觉模型使用其提供方默认值（同 installModelSelection 的处理）。
    const { reasoningEffort: _inheritedEffort, ...withoutInheritedEffort } = resolved
    return {
      ...withoutInheritedEffort,
      provider,
      model,
    }
  })
}
