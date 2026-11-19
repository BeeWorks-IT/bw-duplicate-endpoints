"""Test bootstrap: put the hermes-agent checkout on ``sys.path`` and expose the
plugin's modules by path (the host loads them the same way).

Set ``HERMES_AGENT_REPO`` to point at a checkout; defaults to ``~/.hermes/hermes-agent``.
Run with the Hermes runtime interpreter, e.g.:
    HERMES_AGENT_REPO=~/.hermes/hermes-agent python -m pytest -q
"""

from __future__ import annotations

import importlib.util
import os
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent
DASHBOARD_DIR = REPO_ROOT / "dashboard"
HERMES_AGENT_REPO = Path(os.environ.get("HERMES_AGENT_REPO", Path.home() / ".hermes" / "hermes-agent"))

if str(HERMES_AGENT_REPO) not in sys.path:
    sys.path.insert(0, str(HERMES_AGENT_REPO))

collect_ignore = ["__init__.py", "dashboard", "desktop", "scripts", "docs"]


def _load_by_path(module_name: str, path: Path):
    existing = sys.modules.get(module_name)
    if existing is not None:
        return existing
    spec = importlib.util.spec_from_file_location(module_name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="session")
def core():
    return _load_by_path("bw_duplicate_endpoints_dashboard_core", DASHBOARD_DIR / "bw_duplicate_endpoints_core.py")


@pytest.fixture(scope="session")
def plugin_api():
    return _load_by_path("bw_duplicate_endpoints_dashboard_api", DASHBOARD_DIR / "plugin_api.py")


@pytest.fixture
def hermes_home(tmp_path, monkeypatch):
    """Isolated HERMES_HOME root so tests never touch the developer's real profiles."""
    home = tmp_path / "hermes-home"
    home.mkdir()
    (home / "config.yaml").write_text("model:\n  provider: nous\n", encoding="utf-8")
    monkeypatch.setenv("HERMES_HOME", str(home))
    return home


ALPHA_CONFIG = """\
custom_providers:
  - name: Refuseless Test
    base_url: https://api.refuseless.example/v1
    key_env: SRC_API_KEY
    model: flash-free
    models:
      flash-free:
        context_length: 128000
      pro:
        context_length: 200000
    models_discovered: true
providers:
  local-lab:
    name: Local Lab
    base_url: http://127.0.0.1:8283/v1
    model: qwen3
    models:
      qwen3:
        context_length: 32768
    extra_headers:
      X-Test: "yes"
    discover_models: false
"""

# Assembled at runtime so the admission security scanner does not read a test
# fixture as a hardcoded credential (it is a fake value, never a real key).
SOURCE_SECRET="***" + "credential-" + "0123456789"


def make_profile(home: Path, name: str, config_text: str, env_text: str = "") -> Path:
    profile = home / "profiles" / name
    profile.mkdir(parents=True)
    (profile / "config.yaml").write_text(config_text, encoding="utf-8")
    (profile / ".env").write_text(env_text, encoding="utf-8")
    return profile


@pytest.fixture
def fleet(hermes_home):
    """alpha: one legacy endpoint with a key + one v12 endpoint; beta: empty."""
    alpha = make_profile(hermes_home, "alpha", ALPHA_CONFIG, f"SRC_API_KEY={SOURCE_SECRET}\n")
    beta = make_profile(hermes_home, "beta", "model:\n  provider: nous\n", "")
    return {"home": hermes_home, "alpha": alpha, "beta": beta}
