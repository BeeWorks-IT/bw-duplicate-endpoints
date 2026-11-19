"""Core-logic tests against a throwaway profile fleet under a tmp HERMES_HOME.

Everything runs through Hermes' real config/secret machinery (profile scopes,
config mutation lock, .env credential store) — no mocks of the write path.
"""

from __future__ import annotations

import pytest
import yaml

from conftest import SOURCE_SECRET, make_profile


def _raw(profile_path):
    return yaml.safe_load((profile_path / "config.yaml").read_text(encoding="utf-8")) or {}


def _env_text(profile_path):
    return (profile_path / ".env").read_text(encoding="utf-8")


def _ids(core, profile):
    return [e["id"] for e in core.endpoints(profile)["endpoints"]]


def test_overview_lists_profiles_and_masks_keys(core, fleet):
    data = core.overview()
    names = [p["name"] for p in data["profiles"]]
    assert {"default", "alpha", "beta"} <= set(names)
    alpha = next(p for p in data["profiles"] if p["name"] == "alpha")
    assert len(alpha["endpoints"]) == 2
    legacy = next(e for e in alpha["endpoints"] if e["source"] == "custom_providers")
    assert legacy["has_api_key"] is True
    assert SOURCE_SECRET not in repr(data), "no key value may leave the backend"
    assert all(p["error"] is None for p in data["profiles"])


def test_duplicate_legacy_without_key(core, fleet):
    endpoint_id = next(e["id"] for e in core.endpoints("alpha")["endpoints"] if e["source"] == "custom_providers")
    result = core.duplicate("alpha", [endpoint_id], ["beta"], copy_keys=False)
    assert result["ok"], result
    row = result["results"][0]
    assert row["action"] == "created" and row["key"] == "absent" and row["verified"]
    entry = _raw(fleet["beta"])["providers"][endpoint_id]
    assert entry["base_url"] == "https://api.refuseless.example/v1"
    assert entry["model"] == "flash-free"
    # fidelity: per-model context lengths survive even though the public save
    # payload only carries the default model's length
    assert entry["models"]["pro"]["context_length"] == 200000
    assert "key_env" not in entry and "api_key" not in entry
    assert SOURCE_SECRET not in _env_text(fleet["beta"])
    assert SOURCE_SECRET not in repr(result)


def test_duplicate_with_key_stores_via_hermes(core, fleet):
    endpoint_id = next(e["id"] for e in core.endpoints("alpha")["endpoints"] if e["has_api_key"])
    result = core.duplicate("alpha", [endpoint_id], ["beta"], copy_keys=True)
    assert result["ok"], result
    row = result["results"][0]
    assert row["key"] == "copied" and row["verified"]
    entry = _raw(fleet["beta"])["providers"][endpoint_id]
    assert entry.get("key_env"), "key must be referenced through .env, never inline"
    assert "api_key" not in entry
    assert SOURCE_SECRET in _env_text(fleet["beta"]), "Hermes stores the key in the target .env"
    assert SOURCE_SECRET not in (fleet["beta"] / "config.yaml").read_text(encoding="utf-8")
    assert SOURCE_SECRET not in repr(result)


def test_duplicate_v12_entry_keeps_headers_and_discover_flag(core, fleet):
    result = core.duplicate("alpha", ["local-lab"], ["beta"], copy_keys=False)
    assert result["ok"], result
    entry = _raw(fleet["beta"])["providers"]["local-lab"]
    assert entry["extra_headers"] == {"X-Test": "yes"}
    assert entry["discover_models"] is False
    assert entry["models"]["qwen3"]["context_length"] == 32768


def test_existing_target_key_is_kept_when_not_copying(core, fleet):
    make_profile  # noqa: B018  (fixture helper import kept for clarity)
    beta_cfg = _raw(fleet["beta"])
    beta_cfg["providers"] = {"local-lab": {
        "name": "Local Lab", "base_url": "http://127.0.0.1:8283/v1",
        "model": "qwen3", "key_env": "BETA_OWN_KEY",
    }}
    (fleet["beta"] / "config.yaml").write_text(yaml.safe_dump(beta_cfg), encoding="utf-8")
    (fleet["beta"] / ".env").write_text("BETA_OWN_KEY=sk-beta-own-456\n", encoding="utf-8")
    result = core.duplicate("alpha", ["local-lab"], ["beta"], copy_keys=False)
    assert result["ok"], result
    row = result["results"][0]
    assert row["action"] == "updated" and row["key"] == "kept" and row["verified"]
    entry = _raw(fleet["beta"])["providers"]["local-lab"]
    assert entry["key_env"] == "BETA_OWN_KEY"
    assert "sk-beta-own-456" in _env_text(fleet["beta"])


def test_make_default_activates_target_route(core, fleet):
    result = core.duplicate("alpha", ["local-lab"], ["beta"], copy_keys=False, make_default=True)
    assert result["ok"], result
    assert result["results"][0]["activated"]
    model_cfg = _raw(fleet["beta"]).get("model", {})
    assert str(model_cfg.get("provider", "")).lower().removeprefix("custom:") in {"local-lab", "local lab"}
    assert model_cfg.get("base_url") == "http://127.0.0.1:8283/v1"


def test_source_cannot_be_target(core, fleet):
    with pytest.raises(ValueError):
        core.duplicate("alpha", ["local-lab"], ["alpha"])


def test_unknown_profile_rejected(core, fleet):
    with pytest.raises(ValueError):
        core.duplicate("alpha", ["local-lab"], ["ghost-profile"])


def test_unknown_endpoint_reported_per_row(core, fleet):
    result = core.duplicate("alpha", ["does-not-exist"], ["beta"])
    assert not result["ok"]
    assert result["results"][0]["error"]
    assert "providers" not in _raw(fleet["beta"]) or not _raw(fleet["beta"])["providers"]


def test_incomplete_endpoint_never_written(core, fleet):
    cfg = _raw(fleet["alpha"])
    cfg["providers"]["broken"] = {"name": "Broken", "base_url": "https://x.example/v1"}  # no model
    (fleet["alpha"] / "config.yaml").write_text(yaml.safe_dump(cfg), encoding="utf-8")
    result = core.duplicate("alpha", ["broken"], ["beta"])
    assert not result["ok"]
    assert "model" in result["results"][0]["error"]
    assert "broken" not in (_raw(fleet["beta"]).get("providers") or {})


def test_probe_uses_core_validate_handler(core, fleet, monkeypatch):
    import hermes_cli.web_routers.config_env as config_env

    seen = {}

    async def fake_validate(body):
        seen["base_url"] = body.base_url
        seen["api_key"] = body.api_key
        return {"ok": True, "reachable": True, "message": "", "models": ["flash-free"]}

    monkeypatch.setattr(config_env, "validate_custom_endpoint", fake_validate)
    import asyncio
    endpoint_id = next(e["id"] for e in core.endpoints("alpha")["endpoints"] if e["has_api_key"])
    result = asyncio.run(core.probe("alpha", endpoint_id))
    assert result["ok"] and result["endpoint_id"] == endpoint_id
    assert seen["base_url"] == "https://api.refuseless.example/v1"
    assert seen["api_key"] == SOURCE_SECRET


def test_validate_first_skips_failed_probe(core, fleet, monkeypatch):
    import hermes_cli.web_routers.config_env as config_env

    async def fake_validate(body):
        return {"ok": False, "reachable": False, "message": "unreachable", "models": []}

    monkeypatch.setattr(config_env, "validate_custom_endpoint", fake_validate)
    result = core.duplicate("alpha", ["local-lab"], ["beta"], validate_first=True)
    assert not result["ok"]
    row = result["results"][0]
    assert "pre-flight" in row["error"] and not row["verified"]
    assert "local-lab" not in (_raw(fleet["beta"]).get("providers") or {})


def test_multi_target_batch(core, fleet):
    make_profile(fleet["home"], "gamma", "model:\n  provider: nous\n", "")
    result = core.duplicate("alpha", ["local-lab"], ["beta", "gamma"], copy_keys=False)
    assert result["ok"], result
    assert result["summary"] == {"endpoints": 1, "targets": 2, "succeeded": 2, "failed": 0}
    for name in ("beta", "gamma"):
        assert "local-lab" in _raw(fleet["home"] / "profiles" / name)["providers"]


# ---------------------------------------------------------------------------
# Profile management
# ---------------------------------------------------------------------------

def test_profiles_overview_rich_cards(core, fleet):
    data = core.profiles_overview()
    alpha = next(p for p in data["profiles"] if p["name"] == "alpha")
    assert alpha["endpoint_count"] == 2 and alpha["key_count"] == 1
    assert alpha["home"].endswith("/profiles/alpha")
    assert "gateway_running" in alpha and "skill_count" in alpha
    assert alpha["plugin_enabled"] is False
    assert SOURCE_SECRET not in repr(data)


def test_set_profile_meta_roundtrip(core, fleet):
    result = core.set_profile_meta("alpha", display_name="Atelier RH", description="Gestion & social")
    assert result["display_name"] == "Atelier RH"
    meta = yaml.safe_load((fleet["alpha"] / "profile.yaml").read_text(encoding="utf-8"))
    assert meta["description"] == "Gestion & social"
    assert meta["description_auto"] is False
    # clearing the display name falls back to the canonical id
    result = core.set_profile_meta("alpha", display_name="")
    assert result["display_name"] == ""


def test_set_profile_meta_limits(core, fleet):
    with pytest.raises(ValueError):
        core.set_profile_meta("alpha", display_name="x" * 65)
    with pytest.raises(ValueError):
        core.set_profile_meta("alpha", description="x" * 501)
    with pytest.raises(ValueError):
        core.set_profile_meta("ghost", display_name="x")
    with pytest.raises(ValueError):
        core.set_profile_meta("alpha")


def test_plugin_toggle_uses_admission_transaction(core, fleet):
    assert core.plugin_enabled("beta") is False
    result = core.set_plugin_enabled("beta", True)
    assert result["plugin_enabled"] is True
    cfg = _raw(fleet["beta"])
    assert "bw-duplicate-endpoints" in (cfg.get("plugins", {}).get("enabled") or [])
    result = core.set_plugin_enabled("beta", False)
    assert result["plugin_enabled"] is False
    cfg = _raw(fleet["beta"])
    assert "bw-duplicate-endpoints" in (cfg.get("plugins", {}).get("disabled") or [])
    with pytest.raises(ValueError):
        core.set_plugin_enabled("ghost", True)


def test_activate_endpoint(core, fleet):
    core.duplicate("alpha", ["local-lab"], ["beta"], copy_keys=False)
    result = core.activate("beta", "local-lab")
    assert result["ok"] is True
    model_cfg = _raw(fleet["beta"])["model"]
    assert model_cfg.get("base_url") == "http://127.0.0.1:8283/v1"


def test_on_conflict_skip_leaves_target_untouched(core, fleet):
    core.duplicate("alpha", ["local-lab"], ["beta"], copy_keys=False)
    before = (fleet["beta"] / "config.yaml").read_text(encoding="utf-8")
    result = core.duplicate("alpha", ["local-lab"], ["beta"], copy_keys=True, on_conflict="skip")
    assert result["ok"], result
    row = result["results"][0]
    assert row["action"] == "skipped" and row["key"] == "absent"
    assert (fleet["beta"] / "config.yaml").read_text(encoding="utf-8") == before
    assert SOURCE_SECRET not in _env_text(fleet["beta"])
    with pytest.raises(ValueError):
        core.duplicate("alpha", ["local-lab"], ["beta"], on_conflict="bogus")


# ---------------------------------------------------------------------------
# Multi-profile creation (New endpoint form)
# ---------------------------------------------------------------------------

def test_create_endpoint_multi_profile_with_key(core, fleet):
    make_profile(fleet["home"], "gamma", "model:\n  provider: nous\n", "")
    result = core.create_endpoint(
        "My API", "https://api.example.com/v1", "m1", ["beta", "gamma"],
        **{"api_key": SOURCE_SECRET},
    )
    assert result["ok"], result
    assert result["summary"] == {"profiles": 2, "succeeded": 2, "failed": 0}
    for name in ("beta", "gamma"):
        profile = fleet["home"] / "profiles" / name
        entry = _raw(profile)["providers"]["my-api"]
        assert entry["base_url"] == "https://api.example.com/v1"
        assert entry["model"] == "m1"
        assert entry.get("key_env") and "api_key" not in entry
        assert SOURCE_SECRET in _env_text(profile)
        row = next(r for r in result["results"] if r["profile"] == name)
        assert row["action"] == "created" and row["key"] == "copied" and row["verified"]
    assert SOURCE_SECRET not in repr(result)


def test_create_endpoint_keyless_and_make_default(core, fleet):
    result = core.create_endpoint(
        "Local Lab", "http://127.0.0.1:8283/v1", "qwen3", ["beta"], make_default=True,
    )
    assert result["ok"], result
    row = result["results"][0]
    assert row["key"] == "absent" and row["activated"] and row["verified"]
    entry = _raw(fleet["beta"])["providers"]["local-lab"]
    assert "key_env" not in entry and "api_key" not in entry
    assert _raw(fleet["beta"])["model"].get("base_url") == "http://127.0.0.1:8283/v1"


def test_create_endpoint_validation(core, fleet):
    with pytest.raises(ValueError):
        core.create_endpoint("", "https://x.example/v1", "m", ["beta"])
    with pytest.raises(ValueError):
        core.create_endpoint("X", "not-a-url", "m", ["beta"])
    with pytest.raises(ValueError):
        core.create_endpoint("X", "https://x.example/v1", "", ["beta"])
    with pytest.raises(ValueError):
        core.create_endpoint("X", "https://x.example/v1", "m", [])
    with pytest.raises(ValueError):
        core.create_endpoint("X", "https://x.example/v1", "m", ["ghost"])
    with pytest.raises(ValueError):
        core.create_endpoint("X", "https://x.example/v1", "m", ["beta"], api_mode="bogus")
