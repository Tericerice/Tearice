"""Only harmless subprocesses are started; phone commands stay mocked."""
import asyncio
import collections
import json
import sys
import time
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient

import app as dashboard


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setattr(dashboard, "_BASE_DIR", str(tmp_path))
    monkeypatch.setattr(dashboard, "RUNNING_PROCESSES", {})
    monkeypatch.setattr(dashboard, "LOG_BUFFERS", {})
    monkeypatch.setattr(dashboard, "_LOG_FILE_HANDLES", {})
    with TestClient(dashboard.app) as client:
        yield client
    dashboard._cleanup_all_processes()


def test_only_energy_task_is_exposed_and_no_autostart(client, monkeypatch):
    popen = Mock()
    monkeypatch.setattr(dashboard.subprocess, "Popen", popen)
    result = client.get("/api/apps").json()["apps"]
    assert len(result) == 1
    assert result[0]["id"] == dashboard.TASK_ID
    assert result[0]["status"] == "stopped"
    assert "command" not in result[0]
    assert "working_dir" not in result[0]
    assert client.get("/").status_code == 200
    popen.assert_not_called()


def test_unknown_targets_cannot_launch_or_stop(client):
    assert client.post("/api/start/stock-analysis").status_code == 404
    assert client.post("/api/stop/stock-analysis").status_code == 404
    assert client.post("/api/publish/open").status_code == 404


def test_double_start_does_not_spawn_duplicate(client, monkeypatch):
    process = Mock(pid=1234)
    process.poll.return_value = None
    popen = Mock(return_value=process)
    monkeypatch.setattr(dashboard.subprocess, "Popen", popen)
    monkeypatch.setattr(dashboard, "_start_log_reader", Mock())
    monkeypatch.setattr(dashboard, "_graceful_stop", Mock())
    assert client.post(f"/api/start/{dashboard.TASK_ID}").status_code == 200
    assert client.post(f"/api/start/{dashboard.TASK_ID}").status_code == 409
    assert popen.call_count == 1
    assert client.post(f"/api/stop/{dashboard.TASK_ID}").json()["ok"]


def test_real_harmless_process_logs_and_exit_status(client, monkeypatch):
    config = dict(dashboard.SUPPORTED_APPS[0])
    config["command"] = [sys.executable, "-u", "-c", "print('本地日志验证', flush=True)"]
    monkeypatch.setattr(dashboard, "SUPPORTED_APPS", [config])
    assert client.post(f"/api/start/{dashboard.TASK_ID}").status_code == 200
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        result = client.get(f"/api/logs/{dashboard.TASK_ID}").json()
        if "本地日志验证" in result["lines"] and not result["running"]:
            break
        time.sleep(.02)
    assert "本地日志验证" in result["lines"]
    assert not result["running"]
    assert client.get("/api/apps").json()["apps"][0]["status"] == "stopped"


def test_stop_terminates_owned_process(client, monkeypatch):
    config = dict(dashboard.SUPPORTED_APPS[0])
    config["command"] = [sys.executable, "-u", "-c", "import time; time.sleep(60)"]
    monkeypatch.setattr(dashboard, "SUPPORTED_APPS", [config])
    assert client.post(f"/api/start/{dashboard.TASK_ID}").status_code == 200
    process = dashboard.RUNNING_PROCESSES[dashboard.TASK_ID]["process"]
    assert client.post(f"/api/stop/{dashboard.TASK_ID}").json()["ok"]
    assert process.poll() is not None


def test_sse_survives_ring_capacity_and_replaced_run_buffer(monkeypatch):
    async def check():
        task_id = dashboard.TASK_ID
        process = Mock()
        process.poll.return_value = None
        buffer = collections.deque([(n, str(n)) for n in range(1, 501)], maxlen=500)
        monkeypatch.setattr(dashboard, "LOG_BUFFERS", {task_id: buffer})
        monkeypatch.setattr(dashboard, "RUNNING_PROCESSES", {task_id: {"process": process}})
        response = await dashboard.stream_logs(task_id)
        stream = response.body_iterator
        try:
            for _ in range(500):
                await stream.__anext__()
            buffer.append((501, "new line"))
            event = await asyncio.wait_for(stream.__anext__(), timeout=1)
            assert json.loads(event.split("data: ")[1])["text"] == "new line"
            dashboard.LOG_BUFFERS[task_id] = collections.deque([(1, "new run")])
            event = await asyncio.wait_for(stream.__anext__(), timeout=1)
            assert json.loads(event.split("data: ")[1])["text"] == "new run"
        finally:
            await stream.aclose()
    asyncio.run(check())
