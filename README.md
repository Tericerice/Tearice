# Tearice 项目合集

这是 Tearice 的项目集合仓库，当前收录两个相互独立的开源项目。每个项目都保留在自己的子目录中，并提供了更完整的安装、开发和测试说明。

## 项目一：`glm-vision-mcp`

[`glm-vision-mcp`](./glm-vision-mcp/) 是一个基于 **Model Context Protocol（MCP）** 的视觉理解服务，同时封装了智谱 GLM 和 Google Gemini 视觉模型。

它把两个视觉后端统一封装成 MCP 工具 `glm_vision_analyze`，可供 IDE、Claude、DeepSeek Harness 等支持 MCP 的客户端调用，用于分析：

- 图片、视频、PDF 和文档
- OCR 内容、图表趋势和异常点
- 视频时间戳、PDF 页码和图片区域坐标
- 结构化结论、证据、置信度和警告信息

其中 GLM 支持图片、视频、PDF 和文档；Gemini 是可选的图片后端，也可在 `auto` 模式下作为 GLM 限流、故障或超时后的回退后端。项目还提供 DeepSeek Harness 接入层。

### 快速开始

```powershell
cd glm-vision-mcp
npm install
Copy-Item .env.example .env
npm test
node server.js
```

使用前请在 `.env` 或系统环境变量中配置 `ZHIPU_API_KEY`。如需使用 Gemini 回退，还需要配置 `GOOGLE_API_KEY` 或 `GEMINI_API_KEY`。密钥不要提交到 GitHub。

更完整的配置和接入方式请查看 [`glm-vision-mcp/README.md`](./glm-vision-mcp/README.md)。

## 项目二：`mic-voice-input`

[`mic-voice-input`](./mic-voice-input/) 是一个面向 React 的 Web Speech API 语音输入 hooks 库。

它解决了浏览器语音识别通常只能使用系统默认麦克风的问题，提供：

- 真实麦克风设备选择，并记住用户的选择
- 所选设备与系统默认设备的双路实时音量条
- 只提交最终语音结果，避免中间识别文本污染撤销记录
- 单一语音识别引擎实例，以及完整的启停和资源释放流程
- Google 语音服务连通性探测
- 稳定的麦克风权限、设备、网络和识别错误码

### 安装

```sh
npm install mic-voice-input
```

要求 React 18 或更高版本。浏览器支持取决于 Web Speech API：Chromium/Edge 和 Safari 可用；Firefox 在没有识别引擎时会返回 `supported: false`。

### 本地开发

```sh
cd mic-voice-input
pnpm install
pnpm test
pnpm build
pnpm typecheck
```

更完整的 API、快速上手示例和排障说明请查看 [`mic-voice-input/README.md`](./mic-voice-input/README.md)。

## 目录结构

```text
.
├── glm-vision-mcp/    # MCP 视觉理解服务
└── mic-voice-input/   # React 语音输入 hooks 库
```

## 许可

两个子项目均采用 MIT 许可证。具体版权和许可说明以各子项目目录中的文件为准。
