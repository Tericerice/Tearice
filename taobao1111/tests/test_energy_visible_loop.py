from datetime import datetime, timedelta, timezone
from unittest.mock import Mock

from tools import taobao_energy as task


def deadline():
    return datetime.now(timezone.utc) + timedelta(minutes=2)


def page(*tasks):
    nodes = [dict(text="做任务赚能量", cx=631, cy=590),
             dict(text="7/50", cx=118, cy=845)]
    for title, y in tasks:
        nodes.extend([
            dict(text=f"{title}(0/1)", cx=430, cy=y),
            dict(text="去完成", cx=1102, cy=y + 32),
        ])
    return nodes


def test_selection_uses_fresh_nodes_after_each_executed_task(monkeypatch):
    first = page(("好物随心逛", 1460), ("好物沉浸看", 1700))
    after = page(("去省钱卡领红包", 1460))
    remaining = [first, after]
    seen = []
    executed = []
    phone = Mock()
    phone.window_size.return_value = (1264, 2780)
    phone.app_current.return_value = dict(package=task.TB, activity="TMSActivity")
    real_select = task.next_task

    def select(device, nodes, attempted, limit):
        seen.append(nodes)
        return real_select(device, nodes, attempted, limit)

    def browse(_, title, seconds, limit, nodes):
        executed.append(title)
        return remaining.pop(0) if remaining else page()

    monkeypatch.setattr(task, "next_task", select)
    monkeypatch.setattr(task, "browse", browse)
    monkeypatch.setattr(task.time, "sleep", lambda _: None)

    assert task.run_loop(phone, first, deadline(), 3, 25) == 3
    assert executed == ["好物随心逛", "好物沉浸看", "去省钱卡领红包"]
    assert len(seen) == 3
    assert seen[0] is first
    assert seen[1] == first
    assert seen[2] is after
    phone.swipe.assert_not_called()


def test_loop_ends_after_current_scan_has_no_eligible_task(monkeypatch):
    nodes = page(("玩趣味小游戏", 1460))
    phone = Mock()
    phone.window_size.return_value = (1264, 2780)
    phone.app_current.return_value = dict(package=task.TB, activity="TMSActivity")
    select = Mock(side_effect=lambda _d, current, *_: (None, current))
    monkeypatch.setattr(task, "next_task", select)

    assert task.run_loop(phone, nodes, deadline(), 5, 25) == 0
    select.assert_called_once()
    phone.swipe.assert_not_called()


def test_main_rechecks_after_round_and_stops_only_when_recheck_finds_nothing(
    monkeypatch, tmp_path,
):
    phone = Mock()
    phone.app_current.return_value = dict(package=task.TB, activity="TMSActivity")
    monkeypatch.setattr(task.sys, "argv", [
        "taobao_energy.py", "run", "--serial", "phone",
    ])
    monkeypatch.setattr(task, "setup_logging", lambda: tmp_path / "session.log")
    monkeypatch.setattr(task, "prepare_ocr", lambda: None)
    monkeypatch.setattr(task, "connect_with_retry", Mock(return_value=phone))
    monkeypatch.setattr(task, "scan", Mock(return_value=[dict(
        text="做任务赚能量", cx=631, cy=590,
    )]))
    opened = [
        dict(text="做任务赚能量", cx=631, cy=590),
        dict(text="7/50", cx=118, cy=845),
    ]
    enter = Mock(return_value=opened)
    monkeypatch.setattr(task, "enter", enter)
    run = Mock(side_effect=[2, 1, 0])
    monkeypatch.setattr(task, "run_loop", run)

    task.main()

    assert run.call_count == 3
    assert enter.call_count == 4
    assert all(call == enter.call_args_list[0] for call in enter.call_args_list)
