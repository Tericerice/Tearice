import os
from pathlib import Path
import sys

import runtime_paths


def test_packaged_worker_uses_same_executable(monkeypatch, tmp_path):
    monkeypatch.setattr(sys, 'frozen', True, raising=False)
    monkeypatch.setattr(sys, 'executable', str(tmp_path / 'taobao1111.exe'))
    assert runtime_paths.task_command() == [str(tmp_path / 'taobao1111.exe'), '--task', 'run', '--repeat', '30']


def test_packaged_resources_and_private_logs_are_separate(monkeypatch, tmp_path):
    monkeypatch.setattr(sys, 'frozen', True, raising=False)
    monkeypatch.setattr(sys, '_MEIPASS', str(tmp_path / 'program'), raising=False)
    monkeypatch.setenv('LOCALAPPDATA', str(tmp_path / 'user'))
    assert runtime_paths.resource_dir() == tmp_path / 'program'
    assert runtime_paths.data_dir() == tmp_path / 'user' / 'taobao1111'


def test_bundled_adb_is_preferred(monkeypatch, tmp_path):
    monkeypatch.setattr(sys, '_MEIPASS', str(tmp_path), raising=False)
    adb = tmp_path / 'platform-tools' / 'adb.exe'
    adb.parent.mkdir()
    adb.touch()
    monkeypatch.setenv('PATH', 'existing')
    monkeypatch.setenv('ADBUTILS_ADB_PATH', 'old')
    runtime_paths.setup_adb()
    assert os.environ['ADBUTILS_ADB_PATH'] == str(adb)
    assert os.environ['PATH'].split(os.pathsep)[0] == str(adb.parent)
