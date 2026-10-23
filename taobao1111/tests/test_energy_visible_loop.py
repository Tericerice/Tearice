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


def screenshot_page(*tasks):
    heights = {
        "搜一搜你心仪的宝(7/10)": 100,
        "好物沉浸看(3/10)": 250,
        "去百度App领现金（0/1）": 400,
        "好物随心逛（1/5)": 550,
        "拍立淘逛感兴趣的宝贝（4/5）": 700,
        "每拉1人最高2000能量（0/10)": 800,
        "天猫积分换能量（0/3)": 900,
        "去玩趣味小游戏(0/3)": 1000,
    }
    nodes = [dict(text="做任务赚能量", cx=631, cy=590)]
    for title in tasks:
        y = heights[title]
        nodes.extend([
            dict(text=title, cx=430, cy=y),
            dict(text="去完成", cx=1102, cy=y + 32),
        ])
    return nodes


def test_pending_tasks_do_not_depend_on_progress_text(monkeypatch):
    nodes = screenshot_page(
        "搜一搜你心仪的宝(7/10)",
        "好物沉浸看(3/10)",
        "去百度App领现金（0/1）",
        "好物随心逛（1/5)",
        "拍立淘逛感兴趣的宝贝（4/5）",
        "每拉1人最高2000能量（0/10)",
        "天猫积分换能量（0/3)",
        "去玩趣味小游戏(0/3)",
    )
    phone = Mock()
    phone.window_size.return_value = (1264, 2780)
    real_select = task.next_task
    assert task.task_progress(nodes) is None
    assert task.has_pending_tasks(nodes, 1264)
    assert task.next_task(
        phone, nodes, set(), deadline(),
    )[0] in {
        "搜一搜你心仪的宝",
        "好物沉浸看",
        "去百度App领现金",
        "好物随心逛",
        "拍立淘逛感兴趣的宝贝",
    }


def test_end_is_confirmed_without_any_pending_task_row():
    nodes = [
        dict(text="做任务赚能量", cx=631, cy=590),
        dict(text="搜一搜你心仪的宝(10/10)", cx=430, cy=100),
        dict(text="已完成", cx=1102, cy=100),
        dict(text="天猫积分换能量(0/3)", cx=430, cy=250),
        dict(text="去玩趣味小游戏(0/3)", cx=430, cy=400),
    ]
    assert task.task_progress(nodes) is None
    assert not task.has_pending_tasks(nodes, 1264)


def test_progress_text_cannot_mark_pending_task_as_finished():
    nodes = [
        dict(text="做任务赚能量", cx=631, cy=590),
        dict(text="50/50", cx=118, cy=845),
        dict(text="好物随心逛（5/5）", cx=430, cy=1460),
        dict(text="去完成", cx=1102, cy=1492),
    ]
    assert task.has_pending_tasks(nodes, 1264)
    phone = Mock()
    phone.window_size.return_value = (1264, 2780)
    assert task.next_task(phone, nodes, set(), deadline())[0] == "好物随心逛"


def test_pending_is_detected_after_page_remount_without_progress(monkeypatch):
    phone = Mock()
    phone.window_size.return_value = (1264, 2780)
    after_remount = screenshot_page("好物沉浸看(3/10)")
    monkeypatch.setattr(phone, "app_current", Mock(return_value=dict(
        package=task.TB, activity="TMSActivity",
    )))
    assert task.has_pending_tasks(after_remount, 1264)
    assert task.next_task(phone, after_remount, set(), deadline())[0] == "好物沉浸看"


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

    found, result = task.run_loop(phone, first, deadline(), 3, 25)
    assert found is True
    assert result == page()
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

    found, result = task.run_loop(phone, nodes, deadline(), 5, 25)
    assert found is False
    assert result is nodes
    select.assert_called_once()
    phone.swipe.assert_not_called()


def test_main_rechecks_after_round_and_stops_only_when_recheck_finds_nothing(
    monkeypatch, tmp_path,
):
    phone = Mock()
    phone.window_size.return_value = (1264, 2780)
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
    run = Mock(side_effect=[
        (True, page(("好物随心逛", 1460))),
        (False, [dict(text="做任务赚能量", cx=631, cy=590)]),
    ])
    monkeypatch.setattr(task, "run_loop", run)

    task.main()

    assert run.call_count == 2
    assert enter.call_count == 3
    assert all(call == enter.call_args_list[0] for call in enter.call_args_list)
