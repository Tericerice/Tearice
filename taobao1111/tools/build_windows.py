"""构建供个人网站分发的 Windows x64 成品，不读取或收集本机 ENV。"""
import importlib.metadata
import io
from pathlib import Path
import platform
import re
import shutil
import subprocess
import sys
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def prepare_adb():
    folder = ROOT / '.vendor' / 'platform-tools'
    if (folder / 'adb.exe').is_file():
        return
    url = 'https://dl.google.com/android/repository/platform-tools-latest-windows.zip'
    with urllib.request.urlopen(url, timeout=120) as response:
        content = response.read()
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        # adb 需要随附 DLL；其他刷机工具不随本程序发布。
        members = [m for m in archive.namelist() if m.startswith('platform-tools/')
                   and (m.endswith('.dll') or m in ('platform-tools/adb.exe',
                        'platform-tools/NOTICE.txt', 'platform-tools/source.properties'))]
        assert 'platform-tools/adb.exe' in members
        assert 'platform-tools/NOTICE.txt' in members
        for name in members:
            relative = Path(name)
            assert '..' not in relative.parts
            target = ROOT / '.vendor' / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(archive.read(name))


def copy_licenses(destination):
    for distribution in importlib.metadata.distributions():
        name = re.sub(r'[^a-zA-Z0-9_.-]', '_', distribution.metadata['Name'])
        for item in distribution.files or ():
            if not any(word in Path(item).name.lower() for word in ('license', 'notice', 'copying')):
                continue
            source = Path(distribution.locate_file(item))
            if source.is_file():
                target = destination / name / source.name
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(source, target)


def main():
    if sys.platform != 'win32' or platform.machine().lower() not in ('amd64', 'x86_64'):
        raise RuntimeError('请在 Windows x64 上构建此发布版')
    subprocess.run(['git', 'diff', '--quiet', 'HEAD', '--', '.'], cwd=ROOT, check=True)
    prepare_adb()
    subprocess.run([sys.executable, '-m', 'PyInstaller', '--noconfirm', '--clean', 'windows.spec'], cwd=ROOT, check=True)
    output = ROOT / 'dist' / 'taobao1111'
    shutil.copyfile(ROOT / 'README.md', output / '使用说明.md')
    copy_licenses(output / 'licenses')
    version = re.search(r'(?m)^version = "([^"]+)"', (ROOT / 'pyproject.toml').read_text(encoding='utf-8')).group(1)
    archive = shutil.make_archive(str(ROOT / 'dist' / f'taobao1111-v{version}-windows-x64'),
                                  'zip', ROOT / 'dist', 'taobao1111')
    print(f'个人网站发布包：{archive}')


if __name__ == '__main__':
    main()
