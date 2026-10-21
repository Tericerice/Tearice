"""Windows 成品入口，同时为管家提供隐藏的任务子进程。"""
import sys

from runtime_paths import setup_adb


def main():
    setup_adb()
    if len(sys.argv) == 3 and sys.argv[1] == '--self-test':
        from self_test import run
        run(sys.argv[2])
        return 0
    if len(sys.argv) == 3 and sys.argv[1] == '--window-test':
        from self_test import window
        window(sys.argv[2])
        return 0
    if len(sys.argv) > 1 and sys.argv[1] == '--task':
        from tools.taobao_energy import cli
        sys.argv = ['taobao_energy.py', *sys.argv[2:]]
        return cli()
    if sys.platform == 'win32' and getattr(sys, 'frozen', False):
        from webview.platforms.winforms import is_chromium
        if not is_chromium:
            import ctypes
            import webbrowser
            if ctypes.windll.user32.MessageBoxW(None,
                    '此电脑缺少窗口组件 Microsoft WebView2 Runtime。是否打开微软官方下载页面？安装后重新打开本程序即可。',
                    '淘金币双11能量', 4 | 0x40) == 6:
                webbrowser.open('https://developer.microsoft.com/microsoft-edge/webview2/')
            return 1
    from app import run_desktop
    run_desktop()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
