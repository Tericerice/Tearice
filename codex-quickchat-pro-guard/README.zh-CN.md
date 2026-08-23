# Codex Quick Chat Pro 防降级守卫

[English](README.md) · [技术原理](docs/how-it-works.md) · [调研记录](docs/research.md)

这是一个面向 Windows 版 **Codex 桌面端 Quick Chat（快速聊天）** 的非官方、精确版本锁定、失败即关闭（fail-closed）的路由守卫。

它会把请求模型固定为 `gpt-5-6-pro`，先缓存助手消息，等服务器返回路由元数据后再决定是否展示。只有服务器提供的全部模型路由字段都精确等于 `gpt-5-6-pro` 时，内容才会放行；如果服务器报告 Mini、字段互相冲突，或者回答结束时仍没有可验证路由证据，回答会被拦截。

> [!IMPORTANT]
> 本项目不能解锁 GPT-5.6 Pro、绕过订阅，也不能命令 OpenAI 后端必须使用某个模型。账号本身必须已经具备 Pro 权限。守卫能做的是：拒绝任何无法由服务器路由元数据证明为 Pro 的回答。

## 当前支持版本

| 平台 | Codex 包版本 | 状态 |
|---|---:|---|
| Windows 11，Microsoft Store | `OpenAI.Codex` `26.818.3698.0` | 已验证 |

未知版本或哈希会被直接拒绝。这是安全设计：不能拿旧偏移静默修改已经变化的压缩代码。

## 安装器实际做什么

1. 查找你电脑上合法安装的 Microsoft Store Codex。
2. 校验原始 `app.asar` 的完整 SHA-256。
3. 通过 `npm ci --ignore-scripts` 安装 lockfile 锁定的工具链，再用 `@electron/asar@4.2.1` 解包。
4. 按公开清单执行 7 个稀疏字节补丁操作。
5. 校验补丁资源和重新封装后的完整哈希。
6. 把你本机的 Codex 复制到用户可写的独立版本目录。
7. 创建使用隔离资料目录、启动前强制验完整性的快捷方式。

仓库不会上传 OpenAI 的 `app.asar`、EXE、DLL、用户资料、Cookie、Token 或截图。补丁清单只保存偏移、被删除片段的哈希，以及重现变换所需的小型替换载荷。

## 前置条件

- Windows 11
- Microsoft Store Codex `26.818.3698.0`
- 账号本身已有 GPT-5.6 Pro 权限
- Node.js `22.12.0` 或更高版本，并带有 `npm`
- 足够容纳第二份本机 Codex 的磁盘空间

使用防降级入口前，请完整退出普通 Codex，包括系统托盘进程。

## 一键安装

```powershell
git clone https://github.com/tonyzaca7755963/codex-quickchat-pro-guard.git
cd codex-quickchat-pro-guard
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Install-Guard.ps1
```

安装完成后，从桌面打开 **Codex Quick Chat Pro Guard**。防降级副本使用独立资料目录，因此第一次可能需要重新登录。

默认安装位置：

```text
%LOCALAPPDATA%\Programs\CodexQuickChatProGuard\26.818.3698.0
```

重复安装默认拒绝覆盖。明确传入 `-Force` 时，旧目录会先移动成带时间戳的备份，再重新安装。

## 只构建、不安装

审计者可以仅重建防降级 `app.asar`，不会复制或启动 Codex：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Install-Guard.ps1 `
  -BuildOnly `
  -BuildOutputDirectory .\build\26.818.3698.0
```

预期防降级归档 SHA-256：

```text
355fa059551c1c5bd57bc26f350cb74587bb43f96a6216a6de8629c3b73f4ac3
```

## 校验与测试

安装后可单独检查完整性：

```powershell
& "$env:LOCALAPPDATA\Programs\CodexQuickChatProGuard\26.818.3698.0\Start-Guard.ps1" -NoUi -VerifyOnly
```

仓库测试完全离线，不需要任何账号或凭据：

```powershell
.\tests\Run-Tests.ps1
```

持有精确原始资源的维护者还可以重放生产补丁：

```powershell
.\tests\Run-Tests.ps1 -SourceAsset C:\path\to\original\app-initial-izy3qYQi.js
```

## 失败即关闭策略

- 快速聊天的外发模型固定为 `gpt-5-6-pro`
- 只接受服务器路由证据：
  - `server_ste_metadata.metadata.resolved_model_slug`
  - `server_ste_metadata.metadata.model_slug`
- 所有实际出现的路由字段都必须等于 `gpt-5-6-pro`
- 验证通过前，助手消息保持缓存，不展示
- 发现 Mini 或字段冲突时，取消流并隐藏已经展示的消息
- 回答完成仍没有路由证据时，丢弃缓存回答

状态机、证据边界和限制见[技术原理](docs/how-it-works.md)。

## 更新与卸载

Codex 更新会改变签名包文件和压缩代码偏移。新版本必须新增一份独立审阅过的清单；旧版脚本会拒绝未知哈希。不要关闭哈希校验。

卸载时，先退出防降级 Codex，再删除对应版本安装目录和桌面快捷方式即可。Microsoft Store 原版 Codex 从未被修改。

## 法律与商标声明

本项目与 OpenAI 无隶属、合作或背书关系。Codex、ChatGPT、GPT 和 OpenAI 是其权利人的商标。MIT 许可证只覆盖本仓库原创的脚本、清单、测试和文档，不授予任何第三方应用或服务的权利。

请自行承担使用风险，并遵守适用的 OpenAI 条款与当地法律。
