"""成品包离线自检：不连接手机，验证本地模型、adb 和管家 HTTP。"""
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import threading
import time
import urllib.request


def run(output):
    original_connect = socket.socket.connect
    def local_only(sock, address):
        if isinstance(address, tuple) and address[0] not in ('127.0.0.1', '::1', 'localhost'):
            raise RuntimeError('离线自检禁止连接外网')
        return original_connect(sock, address)
    socket.socket.connect = local_only
    from PIL import Image, ImageDraw, ImageFont
    from local_ocr import recognize
    from runtime_paths import resource_dir
    import app
    import uvicorn
    from butler.local_server import bind_loopback_socket

    image = Image.new('RGB', (800, 240), 'white')
    font = ImageFont.truetype(str(Path(os.environ['WINDIR']) / 'Fonts' / 'msyh.ttc'), 50)
    ImageDraw.Draw(image).text((40, 70), '赚能量', fill='black', font=font)
    nodes = recognize(image)
    assert any('能量' in node['text'] for node in nodes), '本地 OCR 自检失败'
    adb = Path(shutil.which('adb'))
    assert adb == resource_dir() / 'platform-tools' / 'adb.exe', '未使用自带 adb'
    subprocess.run([str(adb), 'version'], capture_output=True, check=True,
                   creationflags=subprocess.CREATE_NO_WINDOW)
    binding = bind_loopback_socket(0)
    server = uvicorn.Server(uvicorn.Config(app.app, log_level='error'))
    worker = threading.Thread(target=lambda: server.run(sockets=[binding.listener]), daemon=True)
    worker.start()
    url = f'http://127.0.0.1:{binding.actual_port}'
    try:
        for _ in range(100):
            if server.started:
                break
            time.sleep(.1)
        with urllib.request.urlopen(url + '/api/health', timeout=5) as response:
            assert response.status == 200
        with urllib.request.urlopen(url + '/', timeout=5) as response:
            assert len(response.read()) > 1000
        assert len(app.SUPPORTED_APPS) == 1
        assert app.SUPPORTED_APPS[0]['command'][1] == '--task'
        Path(output).write_text(json.dumps(dict(ocr=True, adb=True, dashboard=True,
                                               worker=True, offline=True)), encoding='utf-8')
    finally:
        server.should_exit = True
        worker.join(timeout=5)


def window(output):
    import app
    import webview
    original_create = webview.create_window
    original_start = webview.start
    created = []
    errors = []
    def create(*args, **kwargs):
        kwargs['hidden'] = True
        view = original_create(*args, **kwargs)
        created.append(view)
        return view
    def check():
        try:
            for _ in range(100):
                try:
                    title = created[0].evaluate_js('document.title')
                    if title:
                        break
                except Exception:
                    pass
                time.sleep(.2)
            assert '淘金币' in title or '大管家' in title, '窗口内容未加载'
            Path(output).write_text(json.dumps(dict(window=True, renderer='WebView2')), encoding='utf-8')
        except Exception as error:
            errors.append(error)
        finally:
            created[0].destroy()
    webview.create_window = create
    webview.start = lambda: original_start(check, gui='edgechromium')
    app.run_desktop()
    if errors:
        raise errors[0]
