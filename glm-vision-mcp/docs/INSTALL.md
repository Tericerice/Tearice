# 安装说明（INSTALL.md）

## 前置条件

| 项 | 要求 | 本机实测 |
|----|------|----------|
| WorkBuddy | 支持 stdio MCP + SKILL.md 格式技能 | CodeBuddy Code 内核 2.106.4（内置 @modelcontextprotocol/sdk 1.29+） |
| Node.js | ≥ 18 | v22.22.2 |
| npm | 可用且网络可达 | 10.9.7 |
| 智谱 API Key | open.bigmodel.cn 开通 glm-4.6v-flash | 见下方"配置 Key" |

## 一、安装依赖

```powershell
cd "D:\GitHub Program\glm-vision-mcp"
npm install
npm run lint
npm test
```

## 二、配置 ZHIPU_API_KEY（安全方式，不写明文）

> 目标：密钥不出现在 mcp.json、源码、日志、返回结果中。

### 方式 A：用户环境变量（推荐）

```powershell
# PowerShell（一次性执行）
[Environment]::SetEnvironmentVariable('ZHIPU_API_KEY', '你的Key', 'User')
```

或在系统设置 → 环境变量 → 用户变量中新增 `ZHIPU_API_KEY`。设置后**重启 WorkBuddy**。

### 方式 B：项目 .env（不推荐提交到仓库）

```powershell
Copy-Item .env.example .env
# 编辑 .env 填入 ZHIPU_API_KEY=你的Key
```

### 方式 C：WorkBuddy 连接器界面注入

在"自定义连接器/自定义 MCP"中添加 glm-vision 时，如果有环境变量注入面板，将 `ZHIPU_API_KEY` 填入（仅存在客户端安全存储）。

## 三、注册 MCP（stdio）

MCP 配置已写入 WorkBuddy 实际加载的配置文件（两份保持一致）：
- `D:\WorkBuddy-Data\ProgramData\users\17fbd07b\.workbuddy\mcp.json`
- `C:\ProgramData\WorkBuddy\users\17fbd07b\.workbuddy\mcp.json`

> ⚠️ 注意：不要写进 `%USERPROFILE%\.workbuddy\mcp.json`（那是 bash 的 `~`，WorkBuddy 不读取）。

```json
{
  "mcpServers": {
    "glm-vision": {
      "command": "node",
      "args": ["D:\\GitHub Program\\glm-vision-mcp\\server.js"],
      "cwd": "D:\\GitHub Program\\glm-vision-mcp",
      "env": {
        "GLM_MODEL": "glm-4.6v-flash",
        "GLM_BASE_URL": "https://open.bigmodel.cn/api/paas/v4"
      },
      "disabled": false
    }
  }
}
```

也可在 WorkBuddy **连接器管理 → 自定义连接器** 中手动添加（内容同上）。

验证命令（无需 WorkBuddy 也能测）：
```powershell
cd "D:\GitHub Program\glm-vision-mcp"
node scripts/mock-zhipu-server.js   # 终端 A：启动 mock 智谱
# 终端 B：
$env:GLM_CHAT_ENDPOINT="http://127.0.0.1:9876/api/paas/v4/chat/completions"
$env:ZHIPU_API_KEY="test"
node server.js
```

## 四、启用 Skill

Skill 文件已安装到：
- 主存储：`D:\GitHub Program\skills\glm-vision-auto\SKILL.md`
- WorkBuddy 识别：`C:\ProgramData\WorkBuddy\users\17fbd07b\.workbuddy\skills\glm-vision-auto\SKILL.md`

在 WorkBuddy **技能管理**中确认 `glm-vision-auto` 已启用（列出即视为可用）。

## 五、重启并验证

1. 完全退出并重启 WorkBuddy；
2. 连接器管理中找到 `glm-vision`，点击**信任/连接**（首次审批）；
3. 发一条带图片的消息："看一下这张图，识别里面的文字"，应自动命中 Skill 并返回视觉分析结果；
4. 若提示 `NO_API_KEY`：说明环境变量未生效，重启 WorkBuddy 或改用方式 B/C。

## 六、真实集成测试（需要有效 Key）

```powershell
cd "D:\GitHub Program\glm-vision-mcp"
# 1) 图片 OCR
node scripts/test-real.js --source samples/ocr-sample.png --prompt "识别图中所有文字"
# 2) 视频
node scripts/test-real.js --source samples/sample-clip.mp4 --prompt "总结视频内容，带时间戳"
# 3) PDF
node scripts/test-real.js --source samples/sample-doc.pdf --prompt "提取关键内容，注明页码"
```

## 七、常见问题

| 现象 | 原因 | 解决 |
|------|------|------|
| `NO_API_KEY` | 环境变量未生效 | 重启 WorkBuddy / 检查 .env / 检查变量名拼写 |
| `AUTH_FAILED` (401) | Key 无效/过期/未实名 | 到 open.bigmodel.cn 检查并重新生成 |
| `RATE_LIMITED` (429) | 免费额度用完或过于频繁 | 稍后重试 / 检查账户额度 |
| `MODEL_NOT_FOUND` (404) | 模型未开通或模型名不对 | 确认已开通 glm-4.6v-flash |
| 本地视频/文件报 400 | data URI 不被支持 | 把文件放到公网 URL 后传 URL |
| `PATH_NOT_ALLOWED` | 文件不在允许目录 | 配置 GLM_ALLOWED_DIRS 或把文件放进工作区 |
| `SENSITIVE_PATH` | 命中敏感文件黑名单 | 换用非敏感文件 |
