"""自动化大管家独立版：仅管理淘金币双11能量任务。"""
from __future__ import annotations

import asyncio
import collections
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any, IO

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse
from butler.local_server import bind_loopback_socket

_BASE_DIR = str(Path(__file__).resolve().parent)
TASK_ID = "taobao-double11-energy"
SUPPORTED_APPS = [{
    "id": TASK_ID, "name": "淘金币双11能量", "category": "script",
    "command": [sys.executable, "-u", str(Path(_BASE_DIR) / "tools" / "taobao_energy.py"),
                "run", "--repeat", "30"],
    "working_dir": _BASE_DIR,
    "description": "淘宝 → 支付宝 → 其他应用；缺少应用直接返回；每次最多60分钟",
}]
if os.environ.get("TAOBAO_DEVICE_SERIAL"):
    SUPPORTED_APPS[0]["command"] += ["--serial", os.environ["TAOBAO_DEVICE_SERIAL"]]
RUNNING_PROCESSES: dict[str, dict[str, Any]] = {}
LOG_BUFFERS: dict[str, collections.deque] = {}
_LOG_FILE_HANDLES: dict[str, IO] = {}
MAX_LOG_LINES = 500
_PROCESS_LOCK = asyncio.Lock()
app = FastAPI(title="淘金币双11能量 · 自动化大管家", docs_url=None, redoc_url=None)

def _get_app_config(app_id: str) -> dict[str, Any] | None:
    return next((a for a in SUPPORTED_APPS if a["id"] == app_id), None)

def _is_port_open(port: int, host: str = "127.0.0.1", timeout: float = 0.5) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False

def get_app_status(app_id: str) -> dict[str, Any]:
    """获取指定应用的运行状态快照。

    返回 {"status": "running"|"stopped", "pid": int|None, ...}
    如果进程已死但字典中尚有残留，此函数负责清理。
    """
    app_config = _get_app_config(app_id)
    expected_port = app_config.get("expected_port") if app_config else None

    if app_id not in RUNNING_PROCESSES:
        if expected_port and _is_port_open(int(expected_port)):
            return {"status": "running", "pid": None}
        return {"status": "stopped", "pid": None}

    proc_info = RUNNING_PROCESSES[app_id]
    process: subprocess.Popen = proc_info["process"]

    returncode = process.poll()
    if returncode is None:
        return {
            "status": "running",
            "pid": proc_info["pid"],
            "started_at": proc_info["started_at"],
        }
    else:
        # 进程已自行退出，从字典中清除
        del RUNNING_PROCESSES[app_id]
        return {"status": "stopped", "pid": None, "exit_code": returncode}

def _kill_process_tree(pid: int) -> bool:
    """跨平台强制终止进程树（含所有子进程）。"""
    try:
        if sys.platform == "win32":
            subprocess.run(
                ["taskkill", "/PID", str(pid), "/F", "/T"],
                capture_output=True,
                timeout=10,
            )
        else:
            try:
                os.killpg(os.getpgid(pid), signal.SIGKILL)
            except ProcessLookupError:
                pass
        return True
    except Exception as exc:
        print(f"[Butler] 强制终止进程 {pid} 失败: {exc}", file=sys.stderr)
        return False

def _graceful_stop(process: subprocess.Popen, pid: int) -> None:
    """优雅终止 → 等待超时 → 强制杀进程树。

    先在当前进程上尝试 terminate/CTRL_BREAK，等待最多 3 秒；
    若仍未退出则调用 taskkill / killpg。
    """
    try:
        if sys.platform == "win32":
            process.send_signal(signal.CTRL_BREAK_EVENT)
        else:
            os.killpg(process.pid, signal.SIGTERM)

        try:
            process.wait(timeout=3)
            return  # 已正常退出
        except subprocess.TimeoutExpired:
            pass
    except Exception:
        pass

    # 进程仍未退出 → 上硬手段
    if process.poll() is None:
        _kill_process_tree(pid)
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            pass

def _start_log_reader(process: subprocess.Popen, app_id: str) -> None:
    """启动后台线程，从子进程 stdout 读取日志行。

    每行同时写入两个地方：
      - 内存环形缓冲区 LOG_BUFFERS（供 SSE 实时推送）
      - 日志文件 stderr_{app_id}.log（供离线查阅）

    编码策略：优先 UTF-8 解码（已通过 PYTHONIOENCODING 环境变量强制），
    回退到 GBK（某些非 Python 或 Windows 原生工具可能输出 GBK）。
    """
    buf: collections.deque = collections.deque(maxlen=MAX_LOG_LINES)
    LOG_BUFFERS[app_id] = buf
    sequence = 0

    log_dir = Path(_BASE_DIR) / "logs"
    log_dir.mkdir(exist_ok=True)
    log_path = log_dir / f"{app_id}.log"
    log_file = open(log_path, "w", encoding="utf-8")
    _LOG_FILE_HANDLES[app_id] = log_file

    def _smart_decode(data: bytes) -> str:
        """智能解码：UTF-8 为主，回退 GBK（兼容 emoji 和中文 Windows）。"""
        try:
            return data.decode("utf-8")
        except UnicodeDecodeError:
            return data.decode("gbk", errors="replace")

    def _reader() -> None:
        nonlocal sequence
        try:
            for raw_line in iter(process.stdout.readline, b""):
                line = _smart_decode(raw_line).rstrip("\n\r")
                sequence += 1
                buf.append((sequence, line))
                log_file.write(line + "\n")
                log_file.flush()
        except (ValueError, OSError):
            pass
        finally:
            try:
                process.stdout.close()
            except OSError:
                pass
            try:
                log_file.close()
            except OSError:
                pass

    t = threading.Thread(target=_reader, daemon=True, name=f"log-reader-{app_id}")
    t.start()

def _cleanup_log_state(app_id: str) -> None:
    """清理指定 app 的日志状态（退出时调用）。"""
    LOG_BUFFERS.pop(app_id, None)
    fh = _LOG_FILE_HANDLES.pop(app_id, None)
    if fh:
        try:
            fh.close()
        except OSError:
            pass

def _build_command_env(app_config: dict[str, Any]) -> dict[str, Any]:
    """构建 subprocess.Popen 的 kwargs，确保跨平台进程隔离。"""
    env = os.environ.copy()
    env.pop("PYTHONPATH", None)
    # 强制子进程使用 UTF-8 输出，确保 emoji 和中文正常进入管道
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUTF8"] = "1"
    # 禁用输出缓冲，确保 print() 立即通过管道输出（默认管道模式下缓冲）
    env["PYTHONUNBUFFERED"] = "1"
    pythonpath = app_config.get("pythonpath")
    if pythonpath:
        paths = [str(path) for path in pythonpath]
        env["PYTHONPATH"] = os.pathsep.join(paths)

    kwargs: dict[str, Any] = {
        "stdout": subprocess.PIPE,    # 管道捕获 → 实时日志
        "stderr": subprocess.STDOUT,  # stderr 合并到 stdout 一起捕获
        "stdin": subprocess.DEVNULL,
        "env": env,
    }
    if sys.platform == "win32":
        # 隐藏控制台窗口（对需要显示窗口的应用除外）
        if app_config.get("show_window"):
            kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
        else:
            kwargs["creationflags"] = (
                subprocess.CREATE_NEW_PROCESS_GROUP
                | subprocess.CREATE_NO_WINDOW
            )
    else:
        # Unix: start_new_session 创建新进程组
        kwargs["start_new_session"] = True

    wd = app_config.get("working_dir")
    if wd and os.path.isdir(wd):
        kwargs["cwd"] = wd
    else:
        kwargs["cwd"] = _BASE_DIR

    return kwargs

@app.get("/api/health")
async def health():
    """健康检查。"""
    return {"ok": True, "running_count": len(RUNNING_PROCESSES)}

@app.get("/api/apps")
async def get_apps():
    """获取所有已配置应用及其当前运行状态。

    返回:
        {
            "apps": [
                {
                    "id": "hello-server",
                    "name": "...",
                    "status": "running",
                    "pid": 12345,
                    "started_at": 1719500000.0,
                    "expected_port": 8765,
                    "description": "...",
                },
                ...
            ]
        }
    """
    apps_with_status = []
    for cfg in SUPPORTED_APPS:
        entry = {**cfg}
        # command 列表可能很长，只保留关键信息给前端
        entry.pop("command", None)
        entry.pop("working_dir", None)
        status_info = get_app_status(cfg["id"])
        entry.update(status_info)
        apps_with_status.append(entry)

    return JSONResponse(content={"apps": apps_with_status})

@app.post("/api/start/{app_id}")
async def start_app(app_id: str):
    config = _get_app_config(app_id)
    if config is None:
        raise HTTPException(404, "未找到任务")
    async with _PROCESS_LOCK:
        if get_app_status(app_id)["status"] == "running":
            raise HTTPException(409, "任务已在运行")
        try:
            process = subprocess.Popen(config["command"], **_build_command_env(config))
        except OSError as error:
            raise HTTPException(500, f"启动失败：{error}") from error
        RUNNING_PROCESSES[app_id] = {
            "process": process, "pid": process.pid, "started_at": time.time(),
        }
        _start_log_reader(process, app_id)
    return {"ok": True, "message": "任务已启动", "pid": process.pid}


@app.post("/api/stop/{app_id}")
async def stop_app(app_id: str):
    if _get_app_config(app_id) is None:
        raise HTTPException(404, "未找到任务")
    async with _PROCESS_LOCK:
        info = RUNNING_PROCESSES.get(app_id)
        if info and info["process"].poll() is None:
            await asyncio.to_thread(_graceful_stop, info["process"], info["pid"])
        RUNNING_PROCESSES.pop(app_id, None)
    return {"ok": True, "message": "任务已停止"}


@app.get("/api/logs/{app_id}")
async def get_logs(app_id: str, tail: int = 100):
    """获取指定应用最近 N 行日志（REST）"""
    buf = LOG_BUFFERS.get(app_id)
    if buf is None:
        return {"lines": [], "running": False, "total": 0}

    all_lines = [line for _, line in buf]
    proc_info = RUNNING_PROCESSES.get(app_id)
    running = proc_info is not None and proc_info["process"].poll() is None

    return {
        "lines": all_lines[-tail:],
        "running": running,
        "total": len(all_lines),
    }

@app.get("/api/logs/{app_id}/stream")
async def stream_logs(app_id: str):
    """实时日志 SSE 流。前端用 EventSource 连接。

    事件格式:
      data: {"type": "log",   "text": "..."}
      data: {"type": "exit",  "text": "进程已退出 (exit_code=0)"}
      data: {"type": "info",  "text": "--- 等待进程启动 ---"}
    """
    app_config = _get_app_config(app_id)
    if app_config is None:
        raise HTTPException(status_code=404, detail=f"未找到应用配置: {app_id}")

    async def _event_stream():
        try:
            last_sequence = 0
            previous_buffer = None
            while True:
                buf = LOG_BUFFERS.get(app_id)
                if buf is not previous_buffer:
                    last_sequence = 0
                    previous_buffer = buf
                if buf is None:
                    yield f"data: {json.dumps({'type': 'info', 'text': '--- 暂无日志，请先启动应用 ---'})}\n\n"
                    await asyncio.sleep(2)
                    continue

                for sequence, line in list(buf):
                    if sequence <= last_sequence:
                        continue
                    last_sequence = sequence
                    yield f"data: {json.dumps({'type': 'log', 'text': line})}\n\n"

                proc_info = RUNNING_PROCESSES.get(app_id)
                process = proc_info["process"] if proc_info else None

                if process is None:
                    yield f"data: {json.dumps({'type': 'exit', 'text': '--- 进程已停止 ---'})}\n\n"
                    return

                returncode = process.poll()
                if returncode is not None:
                    yield f"data: {json.dumps({'type': 'exit', 'text': f'--- 进程已退出 (exit_code={returncode}) ---'})}\n\n"
                    return

                await asyncio.sleep(0.2)
        except (asyncio.CancelledError, GeneratorExit):
            pass

    return StreamingResponse(
        _event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )

_ADB_LOG: collections.deque = collections.deque(maxlen=MAX_LOG_LINES)
_ADB_KNOWN_IPS: set = set()

def _find_adb() -> str | None:
    """查找系统可用的 adb 二进制文件。"""
    adb = shutil.which("adb")
    if adb:
        return adb
    candidates = [
        os.path.join(os.environ.get("ANDROID_HOME", ""), "platform-tools", "adb.exe"),
        os.path.join(os.environ.get("ANDROID_SDK_ROOT", ""), "platform-tools", "adb.exe"),
        os.path.expanduser("~/AppData/Local/Android/Sdk/platform-tools/adb.exe"),
        os.path.expanduser("~/AppData/Local/Android/platform-tools/adb.exe"),
    ]
    for p in candidates:
        if os.path.isfile(p):
            return p
    return None


def _exec_adb(args: list[str], timeout: int = 20) -> dict[str, Any]:
    """执行 adb 命令并返回结构化结果。"""
    adb = _find_adb()
    if not adb:
        return {"ok": False, "error": "ADB 未安装或未在 PATH 中", "stdout": "", "stderr": ""}

    cmd_line = f"> adb {' '.join(args)}"
    _ADB_LOG.append(cmd_line)

    try:
        result = subprocess.run(
            [adb] + args,
            capture_output=True, text=True, timeout=timeout,
            encoding="utf-8", errors="replace",
        )
        out = result.stdout.strip()
        err = result.stderr.strip()
        _ADB_LOG.append(out or err or "(无输出)")
        return {
            "ok": result.returncode == 0,
            "returncode": result.returncode,
            "stdout": out,
            "stderr": err,
        }
    except subprocess.TimeoutExpired:
        _ADB_LOG.append("(超时)")
        return {"ok": False, "error": "命令超时", "stdout": "", "stderr": ""}
    except Exception as exc:
        _ADB_LOG.append(f"(错误: {exc})")
        return {"ok": False, "error": str(exc), "stdout": "", "stderr": ""}


def _parse_device_list(text: str) -> list[dict[str, str]]:
    """解析 adb devices -l 输出为结构化列表。"""
    devices: list[dict[str, str]] = []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("List of devices") or "attached" in line:
            continue
        parts = line.split()
        if len(parts) >= 2:
            devices.append({
                "serial": parts[0],
                "status": parts[1],
                "info": " ".join(parts[2:]) if len(parts) > 2 else "",
            })
    return devices


@app.get("/api/adb/status")
async def adb_status():
    """ADB 状态总览：是否安装、版本、当前连接的设备列表。"""
    adb = _find_adb()
    if not adb:
        return {"installed": False, "version": None, "path": None, "devices": []}

    ver_r = _exec_adb(["--version"])
    dev_r = _exec_adb(["devices", "-l"])
    ver_str = (ver_r.get("stdout", "") or "").splitlines()[0] if ver_r.get("stdout") else "?"

    return {
        "installed": True,
        "path": adb,
        "version": ver_str,
        "devices": _parse_device_list(dev_r.get("stdout", "")),
    }


@app.post("/api/adb/connect")
async def adb_connect(data: dict = dict()):
    """无线连接设备: adb connect IP[:PORT]"""
    host = (data.get("host") or "").strip()
    port = (data.get("port") or "").strip()
    if not host:
        raise HTTPException(status_code=400, detail="请输入设备 IP 地址")

    addr = f"{host}:{port}" if port else host
    _ADB_KNOWN_IPS.add(addr)
    result = _exec_adb(["connect", addr], timeout=25)
    return {
        "ok": result["ok"],
        "message": result.get("stdout") or result.get("stderr") or result.get("error", "未知错误"),
    }


@app.post("/api/adb/pair")
async def adb_pair(data: dict = dict()):
    """Android 11+ 无线配对: adb pair IP:PORT CODE"""
    host = (data.get("host") or "").strip()
    port = (data.get("port") or "").strip()
    code = (data.get("code") or "").strip()
    if not host or not port or not code:
        raise HTTPException(status_code=400, detail="请输入 IP、端口 和配对码")

    addr = f"{host}:{port}"
    result = _exec_adb(["pair", addr, code], timeout=30)
    return {
        "ok": result["ok"],
        "message": result.get("stdout") or result.get("stderr") or result.get("error", "未知错误"),
    }


@app.post("/api/adb/disconnect")
async def adb_disconnect(data: dict = dict()):
    """断开设备: 传 host 断开指定设备, 不传则断开所有。"""
    host = (data.get("host") or "").strip()
    args = ["disconnect"]
    if host:
        args.append(host)
    result = _exec_adb(args)
    return {
        "ok": result["ok"],
        "message": result.get("stdout") or result.get("stderr") or result.get("error", "未知错误"),
    }


@app.post("/api/adb/restart")
async def adb_restart():
    """重启 ADB 服务器 (kill-server → start-server)。"""
    kill = _exec_adb(["kill-server"])
    time.sleep(0.3)
    start = _exec_adb(["start-server"])
    ok = kill["ok"] and start["ok"]
    msg = "ADB 服务器已重启"
    if not ok:
        msg = start.get("stdout") or start.get("stderr") or "重启失败"
    return {"ok": ok, "message": msg}


@app.get("/api/adb/log")
async def adb_get_log(tail: int = 200):
    """获取 ADB 命令执行日志。"""
    lines = list(_ADB_LOG)
    return {"lines": lines[-tail:], "total": len(lines)}


# ═══════════════════════════════════════════════════════════════
# ADB QR 扫码配对
# ═══════════════════════════════════════════════════════════════
# 流程：生成 QR → 手机扫码 → adb mdns services 发现 → adb pair → adb connect

import secrets as _secrets
import string as _string
import io as _io
import re as _re
import base64

_ADB_QR_SESSIONS: dict[str, dict] = {}
import qrcode
from qrcode.image.svg import SvgPathFillImage  # noqa: E402


def _parse_mdns_line(line: str) -> dict | None:
    """解析单行 adb mdns services 输出。"""
    parts = line.strip().split("\t")
    if len(parts) < 3:
        return None
    instance_name, service_type = parts[0], parts[1]
    # endpoint format: "<device-address>:<port>"
    ep_match = _re.match(r"^(\d+\.\d+\.\d+\.\d+):(\d+)$", parts[2].strip())
    if not ep_match:
        return None
    return {
        "instance_name": instance_name,
        "service_type": service_type,
        "host": ep_match.group(1),
        "port": ep_match.group(2),
    }


@app.post("/api/adb/qr-generate")
async def adb_qr_generate():
    """生成 ADB 扫码配对会话：创建配对凭证 + 生成 QR 图片。"""
    charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+-=[]{}<>?"
    service_name = "studio-" + "".join(_secrets.choice(charset) for _ in range(10))
    password = "".join(_secrets.choice(charset) for _ in range(11))
    payload = f"WIFI:T:ADB;S:{service_name};P:{password};;"

    # 生成 QR 图片 → base64
    img = qrcode.make(payload, image_factory=SvgPathFillImage)
    buf = _io.BytesIO()
    img.save(buf)
    qr_data_url = "data:image/svg+xml;base64," + base64.b64encode(buf.getvalue()).decode()

    session_id = _secrets.token_hex(8)
    _ADB_QR_SESSIONS[session_id] = {
        "service_name": service_name,
        "password": password,
        "payload": payload,
        "status": "waiting",
        "created_at": time.time(),
        "device_info": None,
    }

    return {
        "session_id": session_id,
        "qr_image": qr_data_url,
        "service_name": service_name,
        "password": password,
        "payload": payload,
    }


@app.get("/api/adb/qr-poll/{session_id}")
async def adb_qr_poll(session_id: str):
    """轮询扫码配对进度。检测 _adb-tls-pairing._tcp 后自动执行 adb pair。"""
    session = _ADB_QR_SESSIONS.get(session_id)
    if not session:
        return {"status": "expired", "device": None, "message": "会话已过期"}

    # 已经完成的直接返回
    if session["status"] != "waiting":
        return {
            "status": session["status"],
            "device": session.get("device_info"),
            "message": session.get("message", ""),
        }

    # 查询 mDNS 服务
    result = _exec_adb(["mdns", "services"])
    if not result["ok"]:
        return {"status": "waiting", "device": None, "message": ""}

    svc_name = session["service_name"]
    target = None

    for line in result.get("stdout", "").splitlines():
        parsed = _parse_mdns_line(line)
        if not parsed:
            continue
        if parsed["service_type"] != "_adb-tls-pairing._tcp":
            continue
        # 匹配实例名称
        inst = parsed["instance_name"]
        if inst == svc_name or inst.startswith(f"{svc_name} "):
            target = parsed
            break

    if not target:
        return {"status": "waiting", "device": None, "message": ""}

    # 找到手机 → 执行 adb pair
    session["device_info"] = target
    pair_r = _exec_adb(["pair", f"{target['host']}:{target['port']}", session["password"]], timeout=30)

    if pair_r["ok"]:
        session["status"] = "paired"
        session["message"] = pair_r.get("stdout", "配对成功")
    else:
        session["status"] = "pair_failed"
        session["message"] = pair_r.get("stderr", "配对失败")

    return {
        "status": session["status"],
        "device": {"host": target["host"], "port": target["port"]},
        "message": session["message"],
    }


@app.post("/api/adb/qr-connect/{session_id}")
async def adb_qr_connect(session_id: str):
    """配对后执行 adb connect（通过 _adb-tls-connect._tcp 找到连接端口）。"""
    session = _ADB_QR_SESSIONS.get(session_id)
    if not session:
        return {"ok": False, "message": "会话已过期"}

    device = session.get("device_info")
    if not device:
        return {"ok": False, "message": "尚未检测到设备，请先完成配对"}

    # 查找 _adb-tls-connect._tcp 服务
    result = _exec_adb(["mdns", "services"])
    if not result["ok"]:
        return {"ok": False, "message": "无法查询 mDNS"}

    connect_target = None
    for line in result.get("stdout", "").splitlines():
        parsed = _parse_mdns_line(line)
        if not parsed:
            continue
        if parsed["service_type"] != "_adb-tls-connect._tcp":
            continue
        if parsed["host"] == device["host"]:
            connect_target = parsed
            break

    if not connect_target:
        return {"ok": False, "message": "未找到连接端点，稍后再试"}

    conn_r = _exec_adb(["connect", f"{connect_target['host']}:{connect_target['port']}"], timeout=15)
    ok = conn_r["ok"]
    msg = conn_r.get("stdout") or conn_r.get("stderr") or ("连接成功" if ok else "连接失败")

    if ok:
        session["status"] = "connected"
        session["message"] = msg

    return {"ok": ok, "message": msg}


@app.post("/api/adb/qr-cancel/{session_id}")
async def adb_qr_cancel(session_id: str):
    """取消配对会话。"""
    if session_id in _ADB_QR_SESSIONS:
        _ADB_QR_SESSIONS[session_id]["status"] = "cancelled"
        return {"ok": True}
    return {"ok": False, "message": "会话不存在"}


def _cleanup_all_processes() -> None:
    """优雅地停止所有子进程。注册为 atexit + SIGINT handler。"""
    if not RUNNING_PROCESSES:
        return
    print(f"\n[大管家] ⚠️ 正在关闭 {len(RUNNING_PROCESSES)} 个子进程...", file=sys.stderr)
    for app_id, info in list(RUNNING_PROCESSES.items()):
        try:
            _graceful_stop(info["process"], info["pid"])
            print(f"  [大管家] ✓ {app_id} 已停止", file=sys.stderr)
        except Exception as exc:
            print(f"  [大管家] ✗ {app_id} 停止失败: {exc}", file=sys.stderr)
    for app_id in list(_LOG_FILE_HANDLES.keys()):
        _cleanup_log_state(app_id)
    print("[大管家] ✅ 所有进程已清理完毕", file=sys.stderr)


_HTML_PATH = os.path.join(_BASE_DIR, "static", "index.html")

@app.get("/", response_class=HTMLResponse)
async def index():
    with open(_HTML_PATH, "r", encoding="utf-8") as f:
        return HTMLResponse(content=f.read())

if __name__ == "__main__":
    import atexit
    import logging
    import threading

    try:
        import webview
    except ImportError:
        sys.exit(
            "缺少 pywebview 依赖。请执行:\n"
            "  pip install pywebview"
        )

    # ── 进程清理保障：无论是 Ctrl+C 还是窗口关闭都能终止子进程 ──
    atexit.register(_cleanup_all_processes)

    # Windows 控制台模式（python.exe）下 Ctrl+C 走 SIGINT
    def _sigint_handler(sig, frame):
        print("\n[大管家] 收到中断信号（Ctrl+C），正在清理...", file=sys.stderr)
        _cleanup_all_processes()
        sys.exit(130)

    signal.signal(signal.SIGINT, _sigint_handler)

    # ── 日志写入文件（pythonw 无控制台，方便排查） ────────────
    Path(_BASE_DIR, "logs").mkdir(exist_ok=True)
    log_file = os.path.join(_BASE_DIR, "logs", "butler.log")
    logging.basicConfig(
        filename=log_file,
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        encoding="utf-8",
    )
    _log = logging.getLogger("butler")

    requested_port = int(os.environ.get("PORT", "9011"))
    server_binding = bind_loopback_socket(requested_port)
    port = server_binding.actual_port
    if server_binding.fell_back:
        _log.warning(
            "桌面端口已占用，使用备用端口: requested_port=%s actual_port=%s",
            requested_port,
            port,
        )
    server = uvicorn.Server(
        uvicorn.Config(app, host="127.0.0.1", port=port, log_level="info")
    )

    # ── 后台线程启动 FastAPI ──────────────────────────────────
    def _run_server() -> None:
        try:
            server.run(sockets=[server_binding.listener])
        except Exception:
            _log.exception("FastAPI 启动失败")

    server_thread = threading.Thread(target=_run_server, daemon=True)
    server_thread.start()
    _log.info("服务器线程已启动, 端口=%s", port)

    # ── 轮询确认服务就绪 ──────────────────────────────────────
    import urllib.request
    url = f"http://127.0.0.1:{port}"
    ready = False
    for attempt in range(20):
        time.sleep(0.5)
        try:
            resp = urllib.request.urlopen(f"{url}/api/health", timeout=2)
            if resp.status == 200:
                ready = True
                _log.info("服务就绪")
                break
        except Exception:
            _log.info(f"等待服务就绪... ({attempt + 1}/20)")

    if not ready:
        _log.error("服务启动超时，请检查 %s", log_file)
        sys.exit(f"服务启动失败，详情见: {log_file}")

    # ── 弹出本地原生窗口 ──────────────────────────────────────
    _log.info("打开 PyWebView 窗口")
    webview.create_window(
        title="淘金币双11能量 · 自动化大管家",
        url=url,
        width=1100,
        height=750,
        resizable=True,
        min_size=(700, 500),
    )
    webview.start()
    _log.info("窗口已关闭，显式清理子进程...")
    _cleanup_all_processes()
    _log.info("退出")
