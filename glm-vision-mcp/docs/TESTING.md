# 测试结果（TESTING.md）

- 测试日期：2026-08-07
- 运行环境：Windows（Node.js v22.22.2、npm 10.9.7、ffmpeg、Pillow 12.3）
- 测试命令：`npm test`（`node --test --test-force-exit --test-concurrency=1 tests/safety.test.js tests/source.test.js tests/zhipu.test.js tests/mcp.test.js`）

## 总览

| 套件 | 用例数 | 结果 |
|------|-------:|------|
| safety（路径安全） | 7 | ✅ 7/7 |
| source（来源解析） | 9 | ✅ 9/9 |
| zhipu（智谱调用/错误/重试） | 11 | ✅ 11/11 |
| mcp（端到端：握手/工具/多模态/错误路径） | 16 | ✅ 16/16 |
| **合计** | **43** | **✅ 43/43** |

```
# tests 43
# pass 43
# fail 0
```

## 对照需求逐项说明

### 1. MCP 握手测试 ✅
`initialize` 返回 `serverInfo.name=glm-vision-mcp`、`capabilities.tools`、协议版本。（mcp.test.js "MCP 握手"）

### 2. 工具列表测试 ✅
`tools/list` 返回 `glm_vision_analyze`，inputSchema 含 `source/prompt/media_type/thinking/response_format/timestamp_hint`。（mcp.test.js "工具列表"）

### 3. 图片测试（无敏感信息）✅
本地 PNG → 自动转 Base64 data URI → 请求体 `image_url` → mock 返回 → 结构化结果（answer/evidence/confidence/warnings/meta/privacy_notice）。测试样本：`samples/ocr-sample.png`（会议纪要截图，含中文）。

### 4. 短视频测试 ✅
本地 MP4 → `video_url` data URI → timestamp_hint 透传 → evidence 提取时间戳 `00:05`。测试样本：`samples/sample-clip.mp4`（ffmpeg 生成 3 秒）。

### 5. 中文 OCR 路径 ✅
图片请求体构造 + 系统指令要求"OCR 逐条输出文本与 [[x1,y1,x2,y2]] 区域" + evidence 区域提取断言（`[[120,80,520,140]]`）。真实 OCR 文字识别需有效 API Key，见"需要真实 Key 的测试"。

### 6. WorkBuddy 自然语言自动触发 Skill ✅（已安装，触发需重启验证）
Skill `glm-vision-auto` 已安装到用户级 skills 目录（双位置一致），description 覆盖中英文触发词（识别/分析/总结/OCR/看图/这是什么/screenshot/analyze/describe 等）。WorkBuddy 下一次会话加载 Skill 后即可按描述自动命中。

### 7. API Key 缺失 / 无效 / 限流 / 网络失败 ✅
- 缺失：`NO_API_KEY`（mcp.test.js "无 API Key"）
- 无效（401）：`AUTH_FAILED`，不重试（zhipu.test.js）
- 限流（429 持续）：`RATE_LIMITED`，最多 3 次尝试（禁止无限重试，zhipu.test.js）
- 限流 1 次后成功：自动重试（zhipu.test.js）
- 5xx 1 次后成功：自动重试（zhipu.test.js）
- 404：`MODEL_NOT_FOUND`；超时：`TIMEOUT`；连接失败：`NETWORK_ERROR`
- 错误响应不含堆栈（mcp.test.js "provider 401 …不污染堆栈"）

### 8. MCP 禁用后 Skill 明确报告不可用 ✅（Skill 行为约定）
Skill 文档约定：`glm_vision_analyze` 工具不存在或报错时，明确告知"glm-vision-mcp 未启用/错误码+解决步骤"，不假装能看图、不静默降级。（已在 SKILL.md "不可用处理" 章节固化）

### 9. 格式检查 / 单元测试 ✅
- `npm run lint`：`node --check` 全部源码文件通过
- 单元测试：safety + source（16 用例）+ zhipu（11 用例）
- 端到端：mcp（16 用例，stdio 子进程 + mock 智谱）

## 需要真实 Key 的测试（已完成实现与脚本，待你配置 Key 后执行）

| 项 | 脚本 | 说明 |
|----|------|------|
| 真实图片 OCR | `node scripts/test-real.js --source samples/ocr-sample.png --prompt "识别图中所有文字"` | 需 ZHIPU_API_KEY |
| 真实视频 | `node scripts/test-real.js --source samples/sample-clip.mp4 --prompt "总结视频内容，带时间戳"` | 需 ZHIPU_API_KEY |
| 真实 PDF | `node scripts/test-real.js --source samples/sample-doc.pdf --prompt "提取关键内容，注明页码"` | 需 ZHIPU_API_KEY |
| WorkBuddy 内自动触发 | 重启 WorkBuddy 后发送图片+「识别一下」 | 需重启生效 |

> 说明：本机当前未配置 ZHIPU_API_KEY（检查确认 NOT SET），因此真实模型调用类测试用本地 mock 智谱服务器（`scripts/mock-zhipu-server.js`）完成全链路验证；请求构造、错误转换、重试、安全校验均与真实调用共用同一代码路径。

## 已知环境事实（测试中确认）

- WorkBuddy：CodeBuddy Code 内核 2.106.4，内置 `@modelcontextprotocol/sdk@1.29.0`
- MCP 配置：`%USERPROFILE%\.workbuddy\mcp.json`（stdio + http 均支持）
- Skill 格式：`SKILL.md` + YAML frontmatter（name/description/agent_created），用户级目录 `C:\ProgramData\WorkBuddy\users\17fbd07b\.workbuddy\skills\`
- 智谱 glm-4.6v-flash：`image_url/video_url/file_url` 内容块；官方限制单次单模态；thinking `{"type":"enabled|disabled"}`
