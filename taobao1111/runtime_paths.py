"""区分只读程序资源与用户运行记录；打包版优先使用自带 adb。"""
import os
from pathlib import Path
import sys


def resource_dir():
    return Path(getattr(sys, '_MEIPASS', Path(__file__).resolve().parent))


def data_dir():
    if getattr(sys, 'frozen', False):
        base = Path(os.environ.get('LOCALAPPDATA', Path.home() / '.local' / 'share'))
        path = base / 'taobao1111'
        path.mkdir(parents=True, exist_ok=True)
        return path
    return Path(__file__).resolve().parent


def setup_adb():
    bundled = resource_dir() / 'platform-tools' / 'adb.exe'
    if bundled.is_file():
        os.environ['PATH'] = str(bundled.parent) + os.pathsep + os.environ.get('PATH', '')
        os.environ['ADBUTILS_ADB_PATH'] = str(bundled)


def task_command():
    if getattr(sys, 'frozen', False):
        return [sys.executable, '--task', 'run', '--repeat', '30']
    return [sys.executable, '-u', str(resource_dir() / 'tools' / 'taobao_energy.py'),
            'run', '--repeat', '30']
