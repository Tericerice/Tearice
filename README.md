# Tearice 项目合集

这是 Tearice 的项目集合仓库，当前收录五个相互独立的开源项目。每个项目都保留在自己的子目录中，并提供完整的安装、开发、测试和许可说明。

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

## 项目三：`DropPoint-FileShelf`

[`DropPoint-FileShelf`](./DropPoint-FileShelf/) 是一个常驻桌面、始终置顶的临时文件架。它基于开源项目 [GameGodS3/DropPoint](https://github.com/GameGodS3/DropPoint) 重构，不依赖 Chrome 扩展，也不绑定任何网站。

主要能力包括：

- 一次拖入多个文件或文件夹，每个项目显示为独立卡片
- 单独把某张卡片拖到浏览器上传区、聊天工具或其他桌面应用
- 图片缩略图，以及文件夹、文本、音频、视频和通用文件类型图标
- 单项移除、全部清空、系统托盘、全局快捷键和始终置顶
- Windows 安装包与 ZIP 构建配置，以及 Electron/Playwright 自动化测试

### 本地开发

```powershell
cd DropPoint-FileShelf
npm ci
npm test
npm start
```

构建 Windows 安装包和 ZIP：

```powershell
npm run build
```

完整使用方式、架构说明、截图和许可证信息请查看 [`DropPoint-FileShelf/README.md`](./DropPoint-FileShelf/README.md)。

## 项目四：`codex-quickchat-pro-guard`

[`codex-quickchat-pro-guard`](./codex-quickchat-pro-guard/) 是一个面向 Windows 版 Codex 桌面端 Quick Chat 的非官方、精确版本锁定、失败即关闭（fail-closed）的 GPT-5.6 Pro 路由守卫。

它不仅把外发模型固定为 `gpt-5-6-pro`，还会在服务器路由元数据完成验证前缓存助手消息：

- 服务器声明的全部路由字段都精确等于 `gpt-5-6-pro` 时才放行回答
- 发现 Mini、字段冲突或其他模型时取消流并拦截回答
- 回答结束仍缺少可验证路由证据时丢弃缓存内容
- 对原始资源、每个补丁片段、补丁结果和启动归档执行 SHA-256 校验
- 从本机 Microsoft Store Codex 创建用户空间副本，不修改原始安装包

当前清单精确支持 Windows Microsoft Store Codex `26.818.3698.0`。账号本身必须已经具有 GPT-5.6 Pro 权限；本项目不会解锁模型或绕过订阅。

### 安装

```powershell
cd codex-quickchat-pro-guard
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Install-Guard.ps1
```

完整的安全边界、构建审计和测试方式请查看 [`codex-quickchat-pro-guard/README.zh-CN.md`](./codex-quickchat-pro-guard/README.zh-CN.md)。项目也保留在[独立仓库](https://github.com/tonyzaca7755963/codex-quickchat-pro-guard)中。

## 项目五：`taobao1111`

[`taobao1111`](./taobao1111/) 是只包含淘金币双11能量任务的独立自动化大管家看板，提供任务启停、实时日志、ADB 扫码配对和本地 OCR 识别。Windows 发布版自带运行环境、OCR 模型和 adb，观众无需部署云服务。

```powershell
cd taobao1111
uv sync
uv run python app.py
```

安装、任务规则与测试说明见 [`taobao1111/README.md`](./taobao1111/README.md)。

## 目录结构

```text
.
├── DropPoint-FileShelf/ # Electron 桌面文件架
├── codex-quickchat-pro-guard/ # Codex Quick Chat GPT-5.6 Pro 防降级守卫
├── taobao1111/         # 淘金币双11能量与独立管家看板
├── glm-vision-mcp/      # MCP 视觉理解服务
└── mic-voice-input/     # React 语音输入 hooks 库
```

## 许可

- `glm-vision-mcp`：MIT
- `mic-voice-input`：MIT
- `codex-quickchat-pro-guard`：MIT
- `DropPoint-FileShelf`：GNU GPL v3 或更高版本（继承自 DropPoint）

各子项目相互独立，具体版权和许可说明以对应目录中的 `LICENSE` 与 README 为准。
