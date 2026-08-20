# vision-mcp-router — 视觉能力 MCP 封装 + 图片路由插件

将视觉能力封装为 **MCP server**（现成的 `glm-vision-mcp`，智谱 GLM-4.6V-Flash），
注册进 DSH 后模型可见工具 **`mcp__glm_vision__glm_vision_analyze`**；
同时在 DSH 侧做**图片附件路由**：用户消息含图时，`agent/pre-step` 把附件物化为
本地临时文件并注入提示，让默认模型调用该工具分析 —— **全程不切换模型**。

## 架构

```
用户发图 ──► dsh web (agent loop)
               │  agent/pre-step（vision-mcp-router 插件）
               │    ├─ ctx.attachments.readImage(ref) → %TEMP%\dsh-vision\<sha256>.<ext>
               │    └─ 追加 user 提示消息：必须调用 mcp__glm_vision__glm_vision_analyze
               ▼
          默认模型（deepseek-v4-flash-max，保持原样）
               │  tools/call
               ▼
   @deepseek-ai/dsh-mcp-client（serverName=glm_vision，stdio）
               │  MCP JSON-RPC
               ▼
   D:\GitHub Program\glm-vision-mcp\server.js
               │  GLM-4.6V-Flash（open.bigmodel.cn，key 取自项目 .env）
               ▼
       结构化结果：answer / evidence / confidence / warnings
```

- **MCP 注册**：`cordis.patch.yml` 中 `@deepseek-ai/dsh-mcp-client` 条目，
  `serverName: glm_vision` → 公开工具名 `mcp__glm_vision__glm_vision_analyze`。
- **路由**：`vision-mcp-router.mjs` 在 `agent/pre-step`（waterfall）中
  `next()` 之后改写 `{ kind: 'enter', messages }`：
  - 收集步骤消息中的 `ImageBlock` 附件（内容寻址 `sha256:...`）；
  - 经 `ctx.attachments.readImage` 物化到 `%TEMP%\dsh-vision\<hex>.<ext>`
    （扩展名取自 mediaType，避免 MCP server 按扩展名推断失败；同名不重复写盘）；
  - 追加一条 `source: { kind: 'plugin' }` 的 user 提示消息（工具名 + 路径 +
    参数规范 + 错误处理要求）；**图片块从进入模型的消息中剔除**（默认模型
    只接受文本，含 `image_url` 会 400；剔除后补占位文本，避免空 content 消息），
    会话历史/UI 展示不受影响；
  - 无 attachments 服务时降级：原样返回，不抛错。
- **常驻指南**：插件通过 `ctx.inject(['systemPrompt'])` 注册
  `tool:vision-mcp` section（视觉使用指南：何时调用、参数规范、四段式回答、
  错误码处理、安全边界）——即"接入指南第 2 步提示词"的机器可执行版。

## 部署位置（已生效）

```
C:\Users\<user>\.dsh\profiles\web\cordis.patch.yml        ← MCP + 路由条目
C:\Users\<user>\.dsh\profiles\web\vision-mcp-router.mjs   ← 路由插件本体
C:\Users\<user>\.dsh\profiles\verify-mcp-router.mjs       ← 验证脚本（运行副本）
```

`dsh web` 对 `cordis.patch.yml` 做配置级 HMR（`watchUserPatches`）；若热加载未生效，
重启 `dsh web` 必达。

## 配置项

### vision-mcp-router（路由插件）

| 键 | 默认值 | 说明 |
|---|---|---|
| `enabled` | `true` | 总开关 |
| `toolName` | `mcp__glm_vision__glm_vision_analyze` | 注入提示引用的工具公开名（须与 mcp-client 条目的 serverName 一致） |
| `visionDir` | `%TEMP%/dsh-vision` | 附件物化目录（须在 glm-vision-mcp 白名单内：默认含系统临时目录） |
| `maxImages` | `8` | 单步最多物化的图片数 |
| `log` | `false` | 日志 |

### glm-vision-mcp（MCP 客户端条目）

`transport: stdio`、`serverName: glm_vision`、`command` 为绝对 node 路径、
`args: ['D:/GitHub Program/glm-vision-mcp/server.js']`、`cwd` 指向项目目录。
**`ZHIPU_API_KEY` 不写入配置**：server 启动时自动读取项目根 `.env`
（或在系统环境变量设置）。`toolCallTimeoutMs: 130000` 覆盖图片（60s）与视频（120s）超时。

## 验证

- `verify-mcp-server.mjs` — 直接对 server.js 做 MCP 握手 + 真实调用
  （`samples/ocr-sample.png`，走智谱 API）：
  ```bash
  node E:/Deepseek工作室/vision-auto-router/verify-mcp-server.mjs
  ```
- `verify-mcp-router.mjs` — 两阶段：
  1. 真实 web profile（base 层 + 用户 patch）boot：条目激活、
     `mcp__glm_vision__glm_vision_analyze` 注册进 `ctx.tools`、
     systemPrompt 含 `tool:vision-mcp` section；
  2. 裸 boot + stub attachments：含图步骤注入 hint、物化文件存在、
     原图块保留、纯文本步骤不注入、无附件服务降级安全。
  ```bash
  cd C:\Users\<user>\.dsh\profiles
  node .\verify-mcp-router.mjs
  ```

实测结果：server 握手/工具列表/真实 OCR 全部通过（6.2s，key 已配置）；
路由注入 9/9 断言通过。

## 与旧方案的关系（已废弃）

旧的 `vision-auto-router.mjs`（`agent/request` 把含图步骤整体切换到
`glm/glm-4v`）已**删除**：web profile 的凭据里没有 `GLM_API_KEY`，
切换必失败；且模型级切换会丢失默认模型的推理强度与质量。
新方案不再切换模型，视觉走 MCP 工具，默认模型保持原样。

`verify-router.mjs`、`e2e-glm.mjs`、`verify-gate.mjs`、`smoke-profile.mjs`、
`verify-desktop.mjs`、`e2e-desktop.mjs` 为旧方案的遗留验证脚本，仅存档。

## 回滚

```bash
copy C:\Users\<user>\.dsh\profiles\web\cordis.patch.yml.bak-visionmcp-* C:\Users\<user>\.dsh\profiles\web\cordis.patch.yml
del  C:\Users\<user>\.dsh\profiles\web\vision-mcp-router.mjs
```

## 文件

- `vision-mcp-router.mjs` — 路由插件本体（作者源 = 部署副本）
- `verify-mcp-server.mjs` — MCP server 直接验证（握手 + 真实调用）
- `verify-mcp-router.mjs` — 两阶段接入/路由验证（运行于 profile 目录）
- 遗留：`vision-auto-router.mjs`、`verify-router.mjs`、`smoke-profile.mjs`、
  `e2e-glm.mjs`、`e2e-desktop.mjs`、`verify-gate.mjs`、`verify-desktop.mjs`
