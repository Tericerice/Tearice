import subprocess
import zipfile

import pytest

import config
import configure
from tools import build_release


@pytest.fixture
def private_config(tmp_path, monkeypatch):
    monkeypatch.setenv('LOCALAPPDATA', str(tmp_path / 'user'))
    monkeypatch.setattr(config, '__file__', str(tmp_path / 'config.py'))
    monkeypatch.setenv('DIANTAO_OCR_SERVER_URL', '')
    monkeypatch.delenv('DIANTAO_OCR_SERVER_URL')
    path = config.config_path()
    path.parent.mkdir(parents=True)
    return path


def test_user_config_survives_project_relocation(private_config, tmp_path, monkeypatch):
    private_config.write_text('DIANTAO_OCR_SERVER_URL=https://private.example.test/ocr\n')
    (tmp_path / '.env').write_text('DIANTAO_OCR_SERVER_URL=https://legacy.example.test/ocr\n')
    config.load_config()
    assert config.os.environ['DIANTAO_OCR_SERVER_URL'] == 'https://private.example.test/ocr'
    monkeypatch.setattr(config, '__file__', str(tmp_path / 'new-release' / 'config.py'))
    monkeypatch.delenv('DIANTAO_OCR_SERVER_URL')
    config.load_config()
    assert config.os.environ['DIANTAO_OCR_SERVER_URL'] == 'https://private.example.test/ocr'


def test_environment_overrides_user_config(private_config, monkeypatch):
    private_config.write_text('DIANTAO_OCR_SERVER_URL=https://private.example.test/ocr\n')
    monkeypatch.setenv('DIANTAO_OCR_SERVER_URL', 'https://override.example.test/ocr')
    config.load_config()
    assert config.os.environ['DIANTAO_OCR_SERVER_URL'] == 'https://override.example.test/ocr'


def test_legacy_project_config_still_works(private_config, tmp_path):
    (tmp_path / '.env').write_text('DIANTAO_OCR_SERVER_URL=https://legacy.example.test/ocr\n')
    config.load_config()
    assert config.os.environ['DIANTAO_OCR_SERVER_URL'] == 'https://legacy.example.test/ocr'


def test_setup_preserves_existing_user_configuration(private_config):
    private_config.write_text('DIANTAO_OCR_SERVER_URL=https://private.example.test/ocr\n')
    before = private_config.read_bytes()
    assert configure.ensure_config() == private_config
    assert private_config.read_bytes() == before


def test_setup_imports_legacy_without_removing_source(private_config, tmp_path, monkeypatch):
    monkeypatch.setattr(configure, '__file__', str(tmp_path / 'configure.py'))
    legacy = tmp_path / '.env'
    legacy.write_text('DIANTAO_OCR_SERVER_URL=https://legacy.example.test/ocr\n')
    assert configure.ensure_config().read_bytes() == legacy.read_bytes()


@pytest.fixture
def release_repo(tmp_path, private_config):
    root = tmp_path / 'repo'
    root.mkdir()
    for name in build_release.FILES:
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text('version = "0.2.0"\n' if name == 'pyproject.toml' else 'public example\n', encoding='utf-8')
    # 即使配置、日志、截图被错误跟踪，白名单也不能打入包内。
    for name in ('.env', 'session.log', 'phone.png'):
        (root / name).write_text('PRIVATE_TEST_VALUE=private-fixture-value\n')
    subprocess.run(['git', 'init', '-q', str(root)], check=True)
    subprocess.run(['git', 'add', '.'], cwd=root, check=True)
    subprocess.run(['git', '-c', 'user.name=Release Test', '-c', 'user.email=test@example.test', 'commit', '-qm', 'fixture'], cwd=root, check=True)
    return root


def test_release_uses_committed_allowlist_only(release_repo, tmp_path):
    (release_repo / 'README.md').write_text('uncommitted private content')
    target = build_release.build_release(release_repo, tmp_path / 'dist')
    with zipfile.ZipFile(target) as archive:
        assert set(archive.namelist()) == {'taobao1111/' + name for name in build_release.FILES}
        assert archive.read('taobao1111/README.md').splitlines() == [b'public example']


def test_release_blocks_known_private_values(release_repo, private_config, tmp_path):
    private_config.write_text('DIANTAO_OCR_SERVER_URL=https://private.example.test/ocr\n')
    (release_repo / 'README.md').write_text('Accidentally published host: private.example.test')
    subprocess.run(['git', 'add', 'README.md'], cwd=release_repo, check=True)
    subprocess.run(['git', '-c', 'user.name=Release Test', '-c', 'user.email=test@example.test', 'commit', '-qm', 'fixture leak'], cwd=release_repo, check=True)
    with pytest.raises(RuntimeError, match='发布中止') as error:
        build_release.build_release(release_repo, tmp_path / 'dist')
    assert 'private.example.test' not in str(error.value)
    assert not (tmp_path / 'dist').exists()


def test_release_from_project_subdirectory(release_repo, tmp_path):
    project = release_repo / 'subproject'
    for name in build_release.FILES:
        target = project / name
        target.parent.mkdir(parents=True, exist_ok=True)
        (release_repo / name).rename(target)
    subprocess.run(['git', 'add', '-A'], cwd=release_repo, check=True)
    subprocess.run(['git', '-c', 'user.name=Release Test', '-c', 'user.email=test@example.test', 'commit', '-qm', 'nested fixture'], cwd=release_repo, check=True)
    target = build_release.build_release(project, tmp_path / 'dist')
    with zipfile.ZipFile(target) as archive:
        assert set(archive.namelist()) == {'taobao1111/' + name for name in build_release.FILES}
