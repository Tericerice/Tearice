"""仅从 Git 已提交文件白名单生成发布包；不复制工作目录。"""
import argparse
import io
import os
from pathlib import Path
import re
import subprocess
import sys
import tarfile
from urllib.parse import urlsplit
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from config import config_path
from dotenv import dotenv_values

FILES = (
    'README.md', 'pyproject.toml', 'uv.lock', '.env.example',
    'app.py', 'cloud_ocr.py', 'config.py', 'configure.py', 'device_connection.py',
    '启动大管家.cmd', 'run_taobao_energy.cmd', '配置OCR.cmd',
    'butler/__init__.py', 'butler/local_server.py',
    'static/index.html', 'tools/taobao_energy.py',
)


def build_release(project, output):
    def git(*args):
        return subprocess.check_output(['git', *args], cwd=project)

    prefix = git('rev-parse', '--show-prefix').decode().strip().rstrip('/')
    tree = 'HEAD:' + prefix if prefix else 'HEAD'
    repository = git('rev-parse', '--show-toplevel').decode().strip()
    snapshot = subprocess.check_output(['git', 'archive', tree], cwd=repository)
    with tarfile.open(fileobj=io.BytesIO(snapshot)) as archive:
        files = {name: archive.extractfile(name).read() for name in FILES}
    values = [os.environ.get('DIANTAO_OCR_SERVER_URL', '')]
    for path in (config_path(), project / '.env'):
        if path.exists():
            values.extend(value for value in dotenv_values(path).values() if value)
    values += [urlsplit(value).hostname for value in values if value.startswith(('http://', 'https://'))]
    needles = [value.encode() for value in values if value and len(value) > 8]
    for name, content in files.items():
        if any(value in content for value in needles):
            raise RuntimeError(f'发布中止：{name} 包含本机配置值，值已隐藏')
    version = re.search(rb'(?m)^version = "([^"]+)"', files['pyproject.toml']).group(1).decode()
    if not re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+', version):
        raise RuntimeError('发布版本必须采用 x.y.z 格式')
    output.mkdir(parents=True, exist_ok=True)
    target = output / f'taobao1111-v{version}.zip'
    # 全部读取和检查完成后才写包；使用临时文件避免留下半成品。
    temporary = target.with_suffix('.zip.tmp')
    try:
        with zipfile.ZipFile(temporary, 'w', zipfile.ZIP_DEFLATED) as archive:
            for name, content in files.items():
                archive.writestr(f'taobao1111/{name}', content)
        temporary.replace(target)
    finally:
        temporary.unlink(missing_ok=True)
    return target


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1] / 'dist')
    print(build_release(Path(__file__).resolve().parents[1], parser.parse_args().output))
