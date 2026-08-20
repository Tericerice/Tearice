# install-mcp.ps1 — 一键注册 glm-vision MCP + 安装 Skill + 可选写入 API Key
#
# 用法（PowerShell）：
#   powershell -ExecutionPolicy Bypass -File "D:\GitHub Program\glm-vision-mcp\scripts\install-mcp.ps1"
#   带 Key（写入用户环境变量，安全存储，不落盘 JSON）：
#   powershell -ExecutionPolicy Bypass -File "D:\GitHub Program\glm-vision-mcp\scripts\install-mcp.ps1" -ZhipuApiKey "你的Key"

param(
    [string]$ZhipuApiKey = ""
)

$ErrorActionPreference = 'Stop'
$ProjectDir  = 'D:\GitHub Program\glm-vision-mcp'
$SkillMain   = 'D:\GitHub Program\skills\glm-vision-auto'
# WorkBuddy 实际加载的配置/技能目录（两个位置保持一致）
$McpJsonPaths = @(
    'D:\WorkBuddy-Data\ProgramData\users\17fbd07b\.workbuddy\mcp.json',
    'C:\ProgramData\WorkBuddy\users\17fbd07b\.workbuddy\mcp.json'
)
$SkillWBDirs = @(
    'D:\WorkBuddy-Data\ProgramData\users\17fbd07b\.workbuddy\skills\glm-vision-auto',
    'C:\ProgramData\WorkBuddy\users\17fbd07b\.workbuddy\skills\glm-vision-auto'
)

Write-Host '== glm-vision-mcp 安装脚本 ==' -ForegroundColor Cyan

# 1) 可选：写入用户环境变量（不写入任何 JSON/源码）
if ($ZhipuApiKey) {
    [Environment]::SetEnvironmentVariable('ZHIPU_API_KEY', $ZhipuApiKey, 'User')
    Write-Host "[OK] ZHIPU_API_KEY 已写入【用户环境变量】（需重启 WorkBuddy 生效，值不出现在配置文件中）" -ForegroundColor Green
} else {
    $existing = [Environment]::GetEnvironmentVariable('ZHIPU_API_KEY', 'User')
    if ($existing) {
        Write-Host "[OK] 检测到用户环境变量 ZHIPU_API_KEY 已存在（长度 $($existing.Length)，不展示值）" -ForegroundColor Green
    } else {
        Write-Host "[提示] 未检测到 ZHIPU_API_KEY。请在环境变量或项目 .env 中配置（参考 .env.example）。" -ForegroundColor Yellow
    }
}

# 2) 注册 MCP（合并进 WorkBuddy 实际加载的 mcp.json，保留既有条目）
foreach ($McpJsonPath in $McpJsonPaths) {
    if (-not (Test-Path $McpJsonPath)) {
        Write-Host "[错误] 找不到 $McpJsonPath，请确认 WorkBuddy 用户目录。已跳过该份 MCP 注册。" -ForegroundColor Red
        continue
    }
    $backup = "$McpJsonPath.bak-$(Get-Date -Format 'yyyyMMddHHmmss')"
    Copy-Item $McpJsonPath $backup
    Write-Host "[备份] 已备份原配置到 $backup" -ForegroundColor Green

    $cfg = Get-Content $McpJsonPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if (-not $cfg.mcpServers) { $cfg | Add-Member -NotePropertyName mcpServers -NotePropertyValue ([pscustomobject]@{}) }

    $glmVision = [pscustomobject]@{
        command = 'node'
        args    = @("$ProjectDir\server.js")
        cwd     = $ProjectDir
        env     = [pscustomobject]@{
            GLM_MODEL    = 'glm-4.6v-flash'
            GLM_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4'
        }
        disabled = $false
    }
    $cfg.mcpServers | Add-Member -NotePropertyName 'glm-vision' -NotePropertyValue $glmVision -Force
    $cfg | ConvertTo-Json -Depth 8 | Set-Content $McpJsonPath -Encoding UTF8
    Write-Host "[OK] 已注册 MCP「glm-vision」到 $McpJsonPath（未写入 API Key 明文）" -ForegroundColor Green
}

# 3) 安装 Skill（双位置一致）
foreach ($SkillWB in $SkillWBDirs) {
    New-Item -ItemType Directory -Force -Path $SkillWB | Out-Null
    Copy-Item "$SkillMain\SKILL.md" "$SkillWB\SKILL.md" -Force
    Write-Host "[OK] Skill 已安装: $SkillWB" -ForegroundColor Green
}
Write-Host "[OK] Skill 主存储: $SkillMain" -ForegroundColor Green

# 4) 收尾提示
Write-Host "`n== 完成。请手动完成以下步骤 ==" -ForegroundColor Cyan
Write-Host "1. 完全退出并重启 WorkBuddy（MCP 与 Skill 才会加载）"
Write-Host "2. 连接器管理 → 自定义连接器 → 找到 glm-vision → 点击 信任/连接（首次审批）"
Write-Host "3. 技能管理 → 确认 glm-vision-auto 已启用"
Write-Host "4. 发送一张图片并说「识别一下里面的文字」验证"
