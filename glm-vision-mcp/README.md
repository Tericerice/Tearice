# glm-vision-mcp

一个基于 **Model Context Protocol (MCP)** 的视觉理解服务，将智谱 GLM（`glm-4.6v-flash`）与 Google Gemini（`gemini-3.5-flash`，可选）视觉模型封装为 MCP 工具 `glm_vision_analyze`，通过 **stdio** 方式运行，让任意支持 MCP 的客户端（如 IDE、Claude、DeepSeek Harness 等）都能分析图片、视频、PDF 与文档，并获得带时间戳 / 页码 / 区域坐标的结构化结果。

---

## 功能特性

- **多模态分析**：支持本地路径或公网 URL 的图片、视频、PDF 与文档（文本、图表、表格等）。
- **结构化返回**：每次调用返回 `answer`（结论）、`evidence`（时间戳 / 页码 / 区域坐标）、`confidence`（置信度）与 `warnings`。
- **按媒体类型优化**：自动匹配媒体类型（`auto` / `image` / `video` / `file`），内置针对视频（带时间戳）、PDF / 文档（带页码）、图片（OCR + 区域坐标）的系统提示词模板。
- **OCR 与图表解读**：可逐条输出识别文本并给出区域坐标，可描述图表的趋势、极值与异常点。
- **复杂推理可选**：`thinking` 参数开关键控式推理，默认关闭以节省额度。
- **灵活输出格式**：`response_format` 支持 `text` / `json`。
- **超时与重试**：对 429 / 5xx / 网络错误自动重试（默认最多 2 次，指数退避），支持分媒体类型超时。
- **双后端可选**：`provider` 参数支持 `glm` / `gemini` / `auto`（默认）——`auto` 时 GLM 优先，限流 / 5xx / 无 Key / 超时时图片自动回退 Gemini；Gemini 走 OpenAI 兼容端点，自动使用系统代理（undici ProxyAgent）。
- **洁浔的 stdio 通道**：作为 stdio MCP server 运行，日志走 stderr，不污染协议通道。
- **DeepSeek Harness 接入层**（见 `dsh-integration/`）：自动路由含图步骤、物化附件、剔除图片块，全程不切换模型。

---

## 目录结构

仓库包含两套内容：

```
.
├── README.md                    # 本文档
├── package.json                 # 根 MCP server 依赖与脚本
├── server.js                    # MCP server（stdio）入口，暴露 glm_vision_analyze
├── .env.example                 # 环境变量示例（请复制为 .env 使用）
├── lib/
│   ├── config.js                # 配置读取（环境变量 / .env / 默认值，含路径白名单）
│   ├── safety.js                # 路径与来源安全校验
│   ├── source.js                # 本地 / 公网来源解析与媒体类型推断
│   ├── zhipu.js                 # 智谱 API 封装（调用、重试、错误分类）
│   └── gemini.js                # Google Gemini 后端（OpenAI 兼容端点 + 代理支持）
├── docs/
│   ├── INSTALL.md               # 安装说明
│   ├── TESTING.md               # 测试说明
│   └── UNINSTALL.md             # 卸载说明
├── scripts/                     # 安装脚本、mock 服务器、真实调用脚本
├── samples/                     # 示例素材（chart / ocr / video / pdf）
├── tests/                       # 单元与集成测试
└── dsh-integration/             # DeepSeek Harness 接入层
    ├── vision-mcp-router.mjs    # agent/pre-step 路由插件（含图步骤 → 视觉工具）
    ├── verify-mcp-server.mjs    # 直接验证 MCP server 握手 + 真实调用
    ├── verify-mcp-router.mjs    # 两阶段验证接入与路由行为
    └── README.md                # 接入说明
```

---

## 快速开始

### 前置要求

- **Node.js 18+**
- **智谱开放平台 API Key**：前往 <https://open.bigmodel.cn> 控制台创建。
- **（可选）Google AI API Key**：如需 Gemini 后端（`provider=gemini` 或 `auto` 回退），前往 Google AI Studio 获取，配置到环境变量 `GOOGLE_API_KEY` / `GEMINI_API_KEY`。

### 安装依赖

本仓库使用 npm 作为依赖与锁文件（`package-lock.json`）。在项目根目录执行：

```bash
npm install
```

如你使用 pnpm，亦可：

```bash
pnpm install
```

### 配置 `.env`

复制示例文件并填写真实值（**不要提交 `.env`**，详见「安全说明」）：

```bash
cp .env.example .env   # Windows: copy .env.example .env
```

最小可用配置示例：

```dotenv
# 必填：智谱 API Key（绝不上传）
ZHIPU_API_KEY=your_key_here

# 模型与端点（一般无需修改）
GLM_MODEL=glm-4.6v-flash
GLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4

# 可选：额外允许读取的本地目录（逗号分隔，默认仅允许当前工作区 + 配置目录 + 系统临时目录）
GLM_ALLOWED_DIRS=

# 可选：Gemini 后端（provider=gemini / auto 回退时使用）
GOOGLE_API_KEY=your_google_key_here    # 或 GEMINI_API_KEY
GEMINI_MODEL=gemini-3.5-flash
# GEMINI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
# GEMINI_REQUEST_TIMEOUT_MS=120000      # Gemini 走代理较慢，独立超时（默认 120s）
# VISION_PROVIDER=auto                  # 默认后端：glm | gemini | auto
```

> 更完整的可选配置（请求 / 图片超时、重试次数、分媒体类型大小上限、本地视频 / 文件 data URI 开关、隐私提示开关、`GLM_ALLOW_TMP` 等）请参阅 `.env.example`。

API Key 也可以不写入 `.env`，而直接配置到系统 / 用户环境变量，推荐这样做，可避免密钥出现在任何代码、配置明文或日志中。

### 启动 / 测试

作为 MCP server（stdio）运行：

```bash
node server.js
```

运行测试：

```bash
npm test
```

也可使用 `dsh-integration/` 下的验证脚本（见「验证」）。

### 工具参数与后端选择

`glm_vision_analyze` 主要参数：

| 参数 | 说明 |
|---|---|
| `source`（必填） | 本地绝对路径或 http(s) 公网 URL |
| `prompt`（必填） | 视觉分析指令 |
| `provider` | `auto`（默认）/ `glm` / `gemini`。`auto` 时 GLM 优先，限流 / 5xx / 无 Key / 超时自动回退 Gemini（仅图片） |
| `media_type` | `auto` / `image` / `video` / `file` |
| `thinking` | 复杂推理开关（GLM 支持；Gemini 忽略） |
| `response_format` | `text` / `json` |
| `timestamp_hint` | 视频时间范围提示 |

> Gemini 后端仅支持图片；视频 / PDF / 文档请用 `glm`。Gemini 走代理延迟较高（约 30-120s），超时阈值独立配置（`GEMINI_REQUEST_TIMEOUT_MS`，默认 120s）。

---

## DeepSeek Harness 接入（`dsh-integration/`）

借助 `dsh-integration/vision-mcp-router.mjs` 插件，接入层可以让 DeepSeek Harness 的模型**不切换模型**地处理含图步骤：检测用户消息中的图片附件 → 物化为临时文件 → 剔除图片块 → 注入调用提示让模型调用视觉 MCP 工具逐张分析。

### 1. 注册 MCP server 与路由插件

在 profile 目录的 `cordis.patch.yml` 中插入以下两个条目（`serverName: glm_vision` 注册视觉 MCP server，`vision-mcp-router` 注册路由插件）：

```yaml
insert:
  - id: glm-vision-mcp
    name: @deepseek-ai/dsh-mcp-client
    config:
      serverName: glm_vision
      command: node
      args:
        - server.js
      env:
        GLM_MODEL: glm-4.6v-flash
        GLM_BASE_URL: https://open.bigmodel.cn/api/paas/v4
        # 可选：Gemini 后端（key 在项目 .env 的 GOOGLE_API_KEY / GEMINI_API_KEY）
        GEMINI_MODEL: gemini-3.5-flash
        GEMINI_REQUEST_TIMEOUT_MS: 120000

  - id: vision-mcp-router
    name: ./vision-mcp-router.mjs
    config:
      toolName: mcp__glm_vision__glm_vision_analyze
      maxImages: 8
      log: false
```

> 注册后视觉工具以 `mcp__glm_vision__glm_vision_analyze` 出现在模型工具列表中（`serverName` 与工具名的规范化注册名）。

### 2. 为什么剔除图片块

默认模型**只接受文本内容**：如果决策消息里含有 `image` 类型的 content block（`image_url`），请求会被拒绝并返回 HTTP 400，错误信息形如 `unknown variant image_url`。

因此路由插件在注入提示前会把决策消息中的图片块剔除：

- 图片的实际内容改由 **注入提示**承载（提示中给出每个附件的物化绝对路径 + 工具名 + 使用方法），让模型调用 `glm_vision_analyze` 逐张读取分析；
- 对于**纯图片消息**，在剔除后会补一条占位文本，避免出现空 `content` 的消息。

整个过程**不切换模型**，默认模型保持不变；路由插件零 npm 依赖（仅 Cordis 事件监听），并在无 `attachments` 服务时安全降级为不注入。

---

## 验证

`dsh-integration/` 下提供两个零依赖的验证脚本：

1. **`verify-mcp-server.mjs`** —— 直接验证 MCP server 本身可用性。用极简 JSON-RPC over stdio 客户端与 `server.js` 握手，依次检查：`initialize` 握手 → `tools/list` 列出 `glm_vision_analyze` → `tools/call` 用样本图真实调用一次视觉分析。

   ```bash
   node verify-mcp-server.mjs
   ```

   脚本默认使用 `samples/` 下的示例图片，路径可通过环境变量 `GLM_MCP_SERVER`、`GLM_MCP_SAMPLE` 覆盖。

2. **`verify-mcp-router.mjs`** —— 两阶段验证接入与路由行为：
   - **Phase 1**：用真实 profile boot，确认 `vision-mcp-router` 与 `glm-vision-mcp` 条目被激活、视觉工具注册进 `ctx.tools`、系统提示词含 `tool:vision-mcp` section；
   - **Phase 2**：用裸 boot + stub attachments，验证含图步骤会注入提示、附件物化到临时文件、原图块保留、纯文本步骤不触发路由，以及无附件服务时的安全降级。

   ```bash
   node verify-mcp-router.mjs
   ```

两个脚本均以非零退出码表示存在检查失败，退出前会输出失败项；全部通过时打印 `MCP SERVER VERIFY ALL PASSED` / `MCP ROUTER VERIFY ALL PASSED`。

---

## 安全说明

- **`.env` 绝不入库**：`ZHIPU_API_KEY` 等密钥只存在于本地 `.env`（已被 `.gitignore` 排除）或系统 / 用户环境变量中。任何代码、配置明文、日志都不应出现密钥明文。建议仅把 API Key 配在系统环境变量，避免其出现在 `mcp.json`、源码或日志中。
- **路径白名单机制**：本地来源仅在**允许目录**内开放读取。默认仅允许当前工作区、项目（配置）目录与系统临时目录；如确需放宽，通过 `GLM_ALLOWED_DIRS`（逗号分隔）显式声明，并可在严格模式下用 `GLM_ALLOW_TMP=false` 关闭临时目录访问。路径不在白名单内会返回 `PATH_NOT_ALLOWED`。
- **隐私提示**：默认开启本地文件上传前的隐私提示，提醒用户该文件将发送给所选后端（智谱 AI 或 Google Gemini）进行分析。
- **错误分类**：对 `NO_API_KEY`、`AUTH_FAILED`、`RATE_LIMITED`、`MODEL_NOT_FOUND`、`PATH_NOT_ALLOWED`、`SENSITIVE_PATH` 等错误进行归类并如实返回，便于客户端处理。

---

## License

本仓库以 **MIT** 许可证发布（见 `package.json` 的 `license` 字段）。你可根据实际需求自行修改许可证与作者署名后使用。
