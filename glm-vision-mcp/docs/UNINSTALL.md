# 卸载说明（UNINSTALL.md）

## 一、移除 MCP 注册

**方式 A：脚本**
```powershell
powershell -ExecutionPolicy Bypass -File "D:\GitHub Program\glm-vision-mcp\scripts\uninstall-mcp.ps1"
```

**方式 B：手动**
1. 编辑 `%USERPROFILE%\.workbuddy\mcp.json`，删除 `mcpServers` 下的 `glm-vision` 条目；
2. 若曾在 WorkBuddy 连接器界面添加过，在"自定义连接器"中删除 glm-vision；
3. 重启 WorkBuddy 生效。

## 二、移除 Skill

删除两个位置的 `glm-vision-auto` 目录（内容一致）：
```powershell
Remove-Item "D:\GitHub Program\skills\glm-vision-auto" -Recurse -Force
Remove-Item "C:\ProgramData\WorkBuddy\users\17fbd07b\.workbuddy\skills\glm-vision-auto" -Recurse -Force
```

## 三、移除环境变量（如不再使用）

```powershell
[Environment]::SetEnvironmentVariable('ZHIPU_API_KEY', $null, 'User')
```

> 若该变量被其他项目共用，请跳过此步。

## 四、可选：删除项目

```powershell
Remove-Item "D:\GitHub Program\glm-vision-mcp" -Recurse -Force
```

## 五、卸载后确认

- [ ] `mcp.json` 中不再有 `glm-vision`
- [ ] 两个 skills 目录下不再有 `glm-vision-auto`
- [ ] 重启 WorkBuddy 后连接器列表无 `glm-vision`
