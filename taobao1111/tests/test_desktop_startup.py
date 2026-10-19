from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path
from textwrap import dedent
from typing import Final
from urllib.parse import urlsplit

PROJECT_ROOT: Final = Path(__file__).resolve().parents[1]
APP_PATH: Final = PROJECT_ROOT / "app.py"
REQUESTED_PORT_PATTERN: Final = re.compile(r"^REQUESTED_PORT=(\d+)$", re.MULTILINE)
WINDOW_URL_PATTERN: Final = re.compile(r"^WINDOW_URL=(.+)$", re.MULTILINE)

STARTUP_HARNESS: Final = dedent(
    r"""
    import http.server
    import logging
    import os
    import runpy
    import sys
    import threading
    import types
    import urllib.request

    class ForeignHealthHandler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            body = b'{"foreign":true}'
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, format, *args):
            return

    foreign_server = http.server.ThreadingHTTPServer(
        ("127.0.0.1", 0), ForeignHealthHandler
    )
    foreign_server.daemon_threads = True
    requested_port = foreign_server.server_port
    foreign_thread = threading.Thread(
        target=foreign_server.serve_forever,
        daemon=True,
    )
    foreign_thread.start()
    print(f"REQUESTED_PORT={requested_port}", flush=True)
    os.environ["PORT"] = str(requested_port)

    fake_webview = types.ModuleType("webview")

    def create_window(*, url, **_kwargs):
        with urllib.request.urlopen(f"{url}/api/health", timeout=2) as response:
            print(f"WINDOW_URL={url}", flush=True)
            print(f"WINDOW_HEALTH={response.read().decode('utf-8')}", flush=True)

    def start():
        return

    fake_webview.create_window = create_window
    fake_webview.start = start
    sys.modules["webview"] = fake_webview
    logging.basicConfig = lambda **_kwargs: None

    try:
        runpy.run_path(sys.argv[1], run_name="__main__")
    finally:
        foreign_server.shutdown()
        foreign_server.server_close()
    """
)


def test_desktop_startup_uses_its_own_server_when_requested_port_is_busy() -> None:
    # Given: another healthy HTTP service already owns the requested desktop port.
    # When: the real desktop entry point starts with a fake window boundary.
    result = subprocess.run(  # noqa: S603
        [sys.executable, "-c", STARTUP_HARNESS, str(APP_PATH)],
        cwd=PROJECT_ROOT,
        check=False,
        capture_output=True,
        text=True,
        timeout=20,
    )

    # Then: the window targets a port owned by this Butler, not the foreign service.
    assert result.returncode == 0, result.stderr
    requested_match = REQUESTED_PORT_PATTERN.search(result.stdout)
    window_match = WINDOW_URL_PATTERN.search(result.stdout)
    assert requested_match is not None, result.stdout
    assert window_match is not None, result.stdout
    requested_port = int(requested_match.group(1))
    window_port = urlsplit(window_match.group(1)).port
    assert window_port is not None
    assert window_port != requested_port, (
        "desktop startup approved a health response from a foreign process"
    )
    assert '"running_count"' in result.stdout
    assert '"foreign"' not in result.stdout
