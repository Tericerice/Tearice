# PyInstaller: 同一个可执行文件提供管家窗口和隐藏的任务子进程。
from pathlib import Path
from PyInstaller.utils.hooks import collect_all, collect_dynamic_libs

root = Path(SPECPATH)
datas = [(str(root / 'static'), 'static'),
         (str(root / '.vendor' / 'platform-tools'), 'platform-tools')]
binaries = collect_dynamic_libs('onnxruntime')
hiddenimports = ['uvicorn.logging', 'uvicorn.loops.auto',
                 'uvicorn.protocols.http.auto', 'uvicorn.protocols.websockets.auto',
                 'webview.platforms.edgechromium', 'webview.platforms.winforms']
for package in ('rapidocr_onnxruntime', 'uiautomator2', 'webview'):
    package_data, package_binaries, package_imports = collect_all(package)
    datas += package_data
    binaries += package_binaries
    hiddenimports += package_imports

a = Analysis([str(root / 'desktop.py')], pathex=[str(root)],
             binaries=binaries, datas=datas, hiddenimports=hiddenimports,
             excludes=['pytest', 'PyInstaller', 'tkinter', 'matplotlib', 'IPython'],
             noarchive=False)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name='taobao1111',
          debug=False, strip=False, upx=False, console=True,
          hide_console='hide-early', disable_windowed_traceback=False)
coll = COLLECT(exe, a.binaries, a.datas, strip=False, upx=False, name='taobao1111')
