"""创建或打开项目外的 OCR 配置，不显示其中的值。"""
import os
import shutil
import subprocess
from pathlib import Path

from config import config_path


def ensure_config():
    path = config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        legacy = Path(__file__).with_name('.env')
        shutil.copyfile(legacy if legacy.exists() else Path(__file__).with_name('.env.example'), path)
    return path


def main():
    path = ensure_config()
    print(f'配置文件：{path}')
    if os.name == 'nt':
        subprocess.Popen(['notepad.exe', str(path)])


if __name__ == '__main__':
    main()
