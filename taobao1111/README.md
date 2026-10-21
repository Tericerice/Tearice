# 淘金币双11能量 · 自动化大管家

独立运行的淘金币双11能量看板，从自动化大管家提取进程管理、实时日志、ADB 扫码配对和桌面窗口。任务列表只包含“淘金币双11能量”。安装和运行均在本目录内完成，不依赖点淘项目或完整大管家，也不需要额外注册。OCR 使用现有腾讯云服务器上部署的 PaddleOCR HTTP 服务。

## 启动

需要 Python 3.10–3.13、uv 和 Android SDK Platform-Tools（`adb` 加入 PATH）。在本目录运行：

```powershell
uv sync
uv run python configure.py
uv run python app.py
```

首次启动前，双击 `配置OCR.cmd`（或运行上面的配置命令），将 `DIANTAO_OCR_SERVER_URL` 设置为实际腾讯云 OCR 服务地址。配置固定存放在 `%LOCALAPPDATA%\taobao1111\.env`，不在项目或发布包内；更新、移动或重新解压项目后可以继续使用。非 Windows 系统使用 `~/.config/taobao1111/.env`。

读取顺序：系统环境变量 → 用户配置文件 → 旧版项目目录 `.env`。首次运行配置工具时，若用户配置不存在，会复制旧项目配置或创建示例配置，不覆盖已有用户配置。未配置时任务在连接手机前停止并提示。实际地址不要提交到 GitHub。

Windows 也可双击 `启动大管家.cmd`。看板默认使用本机 9011 端口，端口占用时选择空闲端口。关闭窗口会停止本看板启动的任务。打开看板不会自动执行手机任务，点击“启动”才开始。

## 连接与执行

1. 手机开启开发者选项、无线调试，电脑与手机处于同一网络；也可以通过 USB 调试连接并在手机上允许。
2. 看板“连接手机”页提供 ADB 扫码配对。也可在命令行运行 `adb pair <设备地址>:<配对端口>`，再执行 `adb connect <设备地址>:<调试端口>`。
3. 手机已登录淘宝，在“淘金币任务”页点击“启动”。脚本从淘宝首页进入领淘金币、双11活动和赚能量任务列表。
4. 通过实时日志查看任务、等待、到账和汇总，点击“停止”可结束本次运行。

只有一台在线设备时自动选择；多设备时，在启动看板前设置 `TAOBAO_DEVICE_SERIAL` 环境变量，值取自 `adb devices`。未明确选择时任务会停止并提示。

## 任务规则

- 扫描任务列表后按淘宝内任务 → 支付宝 → 其他应用的顺序处理。
- 进入下载或安装页面、发现目标应用未安装时返回，继续下一项，不主动下载安装。
- 跳过升级赛车、小游戏、天猫积分兑换、拍立淘、邀请、预约提醒及消费类操作。
- 使用 U2 控制设备；活动 WebView 无有效文本时，将截图以 JPEG 发送至配置的腾讯云 PaddleOCR 服务，直接使用原图中心坐标。云端请求失败时停止，不回退到本地 OCR。
- 每次手动启动最多运行60分钟；手机需要自行完成登录，未确认的奖励不会记录为成功。

命令行可调整时限：

```powershell
uv run python tools/taobao_energy.py run --repeat 30 --run-minutes 90
```

活动页面和任务名称可能变化，脚本只执行白名单任务。当前支持的任务以 `tools/taobao_energy.py` 中的 `BROWSE`、`VISIT` 和 `SKIP` 为准。

## 文件与日志

| 位置 | 内容 |
| --- | --- |
| `app.py`、`butler/local_server.py` | 独立管家与本地端口绑定 |
| `static/index.html` | 任务看板、实时日志和设备配对 |
| `tools/taobao_energy.py` | 淘金币任务逻辑 |
| `device_connection.py` | U2 连接重试 |
| `logs/taobao-double11-energy.log` | 看板当前一次运行的简洁日志 |
| `logs/taobao_energy/` | 每次运行的完整 OCR 和异常记录 |
| `screenshots/taobao_energy/` | 最近识别截图及坐标 |

日志、截图、虚拟环境和 `.env` 已忽略，勿把实际设备地址、配对凭证或账号信息写入源码和提交记录。

## 发布版与更新

在仓库的 Releases 中下载 `taobao1111-v0.2.0.zip`，解压后双击 `启动大管家.cmd`。发布包包含双11脚本、独立管家窗口及依赖清单；仍需要上面列出的 Python、uv 和 adb，首次启动会安装依赖，不是免安装 EXE。真实配置只需设置一次。

维护者完成测试并提交代码后，在本目录运行：

```powershell
uv run python tools/build_release.py
```

ZIP 输出到 `dist/`。打包只读取 Git HEAD 中已提交的程序文件白名单，不复制工作目录；排除真实 `.env`、日志、截图和虚拟环境，并检查已知本机配置值是否混入程序文件。发布前仍需检查新增代码和待推送提交中的其他私密内容。

## 验证

```powershell
uv sync --group dev
uv run pytest
```

测试通过模拟边界验证任务与看板，不连接手机或执行淘宝任务。
