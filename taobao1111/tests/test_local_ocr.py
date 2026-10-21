from unittest.mock import Mock

import numpy as np
from PIL import Image
import pytest

import local_ocr
from tools import taobao_energy as task


def test_local_results_preserve_original_coordinates(monkeypatch):
    engine = Mock(return_value=([
        ([[400, 700], [600, 700], [600, 900], [400, 900]], ' 赚能量 ', .99),
        ([[0, 0]] * 4, '低置信度', .2),
        ([[0, 0]] * 4, ' ', .99),
    ], []))
    monkeypatch.setattr(local_ocr, '_engine', engine)
    assert local_ocr.recognize(Image.new('RGBA', (1264, 2780))) == [dict(text='赚能量', cx=500, cy=800)]
    assert engine.call_args.args[0].shape == (2780, 1264, 3)


def test_model_initialization_failure_stops_before_phone_connection(monkeypatch):
    monkeypatch.setattr(task.sys, 'argv', ['taobao_energy.py', 'scan'])
    monkeypatch.setattr(task, 'prepare_ocr', Mock(side_effect=RuntimeError('模型加载失败')))
    connect = Mock()
    monkeypatch.setattr(task, 'connect_with_retry', connect)
    with pytest.raises(RuntimeError, match='模型加载失败'):
        task.main()
    connect.assert_not_called()
    monkeypatch.setattr(task, '_raw_scan', False)


def test_webview_uses_local_ocr(tmp_path, monkeypatch):
    monkeypatch.setattr(task, 'OUT', tmp_path)
    device = Mock()
    device.screenshot.return_value = Image.new('RGB', (1264, 2780))
    device.app_current.return_value = dict(package=task.TB, activity='TMSActivity')
    recognize = Mock(return_value=[dict(text='做任务赚能量', cx=500, cy=800)])
    monkeypatch.setattr(task, 'recognize', recognize)
    task.scan(device)
    recognize.assert_called_once_with(device.screenshot.return_value)
    assert '本地OCR' in (tmp_path / 'current.json').read_text(encoding='utf-8')


def test_native_task_list_does_not_run_ocr(tmp_path, monkeypatch):
    monkeypatch.setattr(task, 'OUT', tmp_path)
    device = Mock()
    device.screenshot.return_value = Image.new('RGB', (1264, 2780))
    device.app_current.return_value = dict(package=task.TB, activity='NativeActivity')
    device.dump_hierarchy.return_value = '<hierarchy><node package="com.taobao.taobao" text="做任务赚能量" bounds="[0,0][100,100]"/></hierarchy>'
    recognize = Mock()
    monkeypatch.setattr(task, 'recognize', recognize)
    task.scan(device)
    recognize.assert_not_called()
