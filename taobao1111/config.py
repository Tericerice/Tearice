"""用户配置独立于项目和发布包。"""
import os
from pathlib import Path

from dotenv import load_dotenv


def config_path():
    base = Path(os.environ['LOCALAPPDATA']) if os.environ.get('LOCALAPPDATA') else Path.home() / '.config'
    return base / 'taobao1111' / '.env'


def load_config():
    # 环境变量优先；用户配置其次；旧版项目配置仅用于兼容。
    load_dotenv(config_path(), override=False)
    load_dotenv(Path(__file__).with_name('.env'), override=False)
