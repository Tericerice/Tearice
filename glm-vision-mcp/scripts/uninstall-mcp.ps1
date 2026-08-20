# uninstall-mcp.ps1 — 卸载 glm-vision MCP 与 Skill
#
# 用法（PowerShell）：
#   powershell -ExecutionPolicy Bypass -File "D:\GitHub Program\glm-vision-mcp\scripts\uninstall-mcp.ps1"
#
# 说明：本脚本只移除 MCP 注册与 Skill 文件，不删除项目代码、不删除 ZHIPU_API_KEY 环境变量
# （如需删除环境变量请手动执行：[Environment]::SetEnvironmentVariable('ZHIPU_API_KEY', $null, 'User')）

$ErrorActionPreference = 'Stop'
$McpJsonPaths = @(
    'D:\WorkBuddy-Data\ProgramData\users\17fbd07b\.workbuddy\mcp.json',
    'C:\ProgramData\WorkBuddy\users\17fbd07b\.workbuddy\mcp.json'
)
$SkillWBDirs = @(
    'D:\WorkBuddy-Data\ProgramData\users\17fbd07b\.workbuddy\skills\glm-vision-auto',
    'C:\ProgramData\WorkBuddy\users\17fbd07b\.workbuddy\skills\glm-vision-auto'
)
$SkillMain   = 'D:\GitHub Program\skills\glm-vision-auto'

Write-Host '== glm-vision-mcp 卸载脚本 ==' -ForegroundColor Cyan

# 1) 从 WorkBuddy 实际加载的 mcp.json 移除 glm-vision
foreach ($McpJsonPath in $McpJsonPaths) {
    if (Test-Path $McpJsonPath) {
        $backup = "$McpJsonPath.bak-$(Get-Date -Format 'yyyyMMddHHmmss')"
        Copy-Item $McpJsonPath $backup
        $cfg = Get-Content $McpJsonPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($cfg.mcpServers.PSObject.Properties.Name -contains 'glm-vision') {
            $cfg.mcpServers.PSObject.Properties.Remove('glm-vision')
            $cfg | ConvertTo-Json -Depth 8 | Set-Content $McpJsonPath -Encoding UTF8
            Write-Host "[OK] 已从 mcp.json 移除 glm-vision（原配置备份: $backup）" -ForegroundColor Green
        } else {
            Write-Host "[提示] $McpJsonPath 中没有 glm-vision 条目" -ForegroundColor Yellow
        }
    }
}

# 2) 删除 Skill（双位置）
foreach ($p in @($SkillWBDirs + $SkillMain)) {
    if (Test-Path $p) {
        Remove-Item $p -Recurse -Force
        Write-Host "[OK] 已删除 Skill 目录: $p" -ForegroundColor Green
    }
}

# 3) 收尾提示
Write-Host "`n== 完成 ==" -ForegroundColor Cyan
Write-Host "- 重启 WorkBuddy 后连接器列表将不再显示 glm-vision"
Write-Host "- ZHIPU_API_KEY 环境变量保留未动；如需删除：" 
Write-Host "  [Environment]::SetEnvironmentVariable('ZHIPU_API_KEY', `$null, 'User')"
