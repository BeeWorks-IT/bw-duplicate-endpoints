"""bw-duplicate-endpoints — cross-profile custom endpoint duplication core.

Loaded by path from ``plugin_api.py`` (the host imports that file with no
package, so this module registers itself under a unique name).

Design rule: every read and write goes through Hermes' OWN config and dashboard
routes — ``hermes_cli.config`` (load/save under the profile scope and the config
mutation lock) and ``hermes_cli.web_routers.config_env`` (the exact handlers the
Settings > Model > Custom endpoints panel calls). A duplication therefore
behaves like saving the endpoint in Settings: same validation, same legacy
``custom_providers`` promotion, same ``.env`` credential lifecycle, same atomic
comment-preserving config writes. Nothing here re-implements config persistence.

Credential policy (plugin-catalog admission rule 11):
  * key VALUES are resolved only through ``agent.secret_scope.get_secret`` under
    the source profile's secret scope — this module never opens a ``.env`` file;
  * key writes happen inside the core upsert handler, which stores them through
    ``hermes_cli.config_secret_refs.store_secret`` (refuses to overwrite a
    variable another endpoint reads);
  * no key value is ever returned to the renderer — only ``has_api_key`` flags,
    exactly like the core list route.
"""

from __future__ import annotations

import copy
import logging
import urllib.parse
from typing import Any, Optional

_log = logging.getLogger(__name__)

PLUGIN_ID = "bw-duplicate-endpoints"
VERSION = "1.0.0"

# Fields that carry (or name) a credential. The fidelity pass never copies them
# from the source: the target's credential state is decided by the core upsert
# handler alone (copy / keep existing / none).
_CREDENTIAL_FIELDS = frozenset({"api_key", "key_env", "api_key_env", "key_cmd"})
# Bookkeeping metadata the compatibility readers add; not part of an entry.
_META_FIELDS = frozenset({"provider_key"})
_API_MODES = ("chat_completions", "codex_responses", "anthropic_messages")


# ---------------------------------------------------------------------------
# Profiles and endpoint inventory
# ---------------------------------------------------------------------------

def list_profiles() -> list[dict[str, Any]]:
    """Every live profile (``default`` + named), resolved through Hermes' API."""
    from hermes_cli.profiles import get_profile_dir, list_profile_names

    profiles = []
    for name in list_profile_names():
        try:
            home = str(get_profile_dir(name))
        except Exception:  # a tombstoned/invalid dir must not break the page
            continue
        profiles.append({"name": name, "home": home, "is_default": name == "default"})
    return profiles


def endpoints(profile: Optional[str] = None) -> dict[str, Any]:
    """The core custom-endpoint list for one profile (masked, renderer-safe)."""
    from hermes_cli.web_routers.config_env import list_custom_endpoints

    return list_custom_endpoints(profile=profile)


def overview() -> dict[str, Any]:
    """All profiles with their endpoints; a broken profile reports its error."""
    profiles = []
    for profile in list_profiles():
        row: dict[str, Any] = {**profile, "endpoints": [], "current": None, "error": None}
        try:
            data = endpoints(profile["name"])
            row["endpoints"] = data.get("endpoints", [])
            row["current"] = data.get("current")
        except Exception as exc:
            _log.warning("bw-duplicate-endpoints: cannot read profile %s: %s", profile["name"], exc)
            row["error"] = str(exc)
        profiles.append(row)
    return {"plugin": PLUGIN_ID, "version": VERSION, "profiles": profiles}


# ---------------------------------------------------------------------------
# Source reading
# ---------------------------------------------------------------------------

def _canonical_entry(entry: dict[str, Any]) -> dict[str, Any]:
    """Normalize a providers entry (or a converted legacy entry) to the shape
    the dashboard writes: ``base_url`` / ``model`` / ``api_mode``. The v12
    migration spells them ``api`` / ``default_model`` / ``transport``; the
    runtime accepts both, but a clone should carry one canonical spelling."""
    out = {k: v for k, v in entry.items() if k not in {"api", "url", "default_model", "transport"}}
    base_url = str(entry.get("base_url") or entry.get("api") or entry.get("url") or "").strip()
    model = str(entry.get("model") or entry.get("default_model") or "").strip()
    api_mode = str(entry.get("api_mode") or entry.get("transport") or "").strip()
    if base_url:
        out["base_url"] = base_url
    if model:
        out["model"] = model
    if api_mode:
        out["api_mode"] = api_mode
    return out


def _entry_key_value(entry: dict[str, Any]) -> Optional[str]:
    """Resolve the entry's API key through Hermes' secret scope only.

    ``load_config()`` already expanded a ``${VAR}`` api_key template to its
    value; a ``key_env`` name is resolved by ``get_secret`` under the active
    profile scope (rule 11 — never a direct .env read)."""
    plaintext = str(entry.get("api_key") or "").strip()
    if plaintext:
        return plaintext
    key_env = str(entry.get("key_env") or entry.get("api_key_env") or "").strip()
    if not key_env:
        return None
    from agent.secret_scope import get_secret

    try:
        value = get_secret(key_env)
    except Exception as exc:
        _log.warning("bw-duplicate-endpoints: get_secret(%s) failed: %s", key_env, exc)
        return None
    value = str(value).strip() if value is not None else ""
    return value or None


def source_endpoint(profile: str, endpoint_id: str) -> tuple[str, dict[str, Any], Optional[str]]:
    """Read one endpoint from the source profile.

    Returns ``(canonical_id, entry, key_value_or_None)``. Handles both storage
    formats: a ``providers.<id>`` entry, or a legacy ``custom_providers`` list
    row (converted with the same helper the core edit/activate routes use).
    Raises ``LookupError`` when the endpoint does not exist.
    """
    from hermes_cli.config import get_compatible_custom_providers, load_config
    from hermes_cli.config_providers import _custom_provider_entry_to_provider_config
    from hermes_cli.web_routers.config_env import _custom_endpoint_id, _resolve_custom_endpoint_entry
    from hermes_cli.web_server_profiles import _config_profile_scope

    with _config_profile_scope(profile):
        cfg = load_config()
        stored_key, entry = _resolve_custom_endpoint_entry(cfg.get("providers"), endpoint_id)
        if entry is not None:
            canonical_id = stored_key
            resolved = _canonical_entry(copy.deepcopy(entry))
        else:
            slug = _custom_endpoint_id(endpoint_id)
            legacy = next(
                (e for e in get_compatible_custom_providers(cfg)
                 if not e.get("provider_key") and _custom_endpoint_id(str(e.get("name") or "")) == slug),
                None,
            )
            if legacy is None:
                raise LookupError(f"custom endpoint not found in profile '{profile}': {endpoint_id}")
            converted = _custom_provider_entry_to_provider_config(legacy, provider_key=slug)
            if not isinstance(converted, dict):
                raise LookupError(f"custom endpoint is not convertible: {endpoint_id}")
            canonical_id = slug
            resolved = _canonical_entry(converted)
        key = _entry_key_value(resolved)
    return canonical_id, resolved, key


def _validate_entry(entry: dict[str, Any]) -> None:
    """The same completeness rules the core save handler enforces."""
    name = str(entry.get("name") or "").strip()
    base_url = str(entry.get("base_url") or "").strip().rstrip("/")
    model = str(entry.get("model") or "").strip()
    if not name:
        raise ValueError("endpoint name is required")
    if not base_url:
        raise ValueError("endpoint base_url is required")
    try:
        parsed = urllib.parse.urlparse(base_url)
    except ValueError as exc:
        raise ValueError("base_url must include scheme and host") from exc
    if not parsed.scheme or not parsed.netloc:
        raise ValueError("base_url must include scheme and host")
    if not model:
        raise ValueError("endpoint default model is required")


def _models_of(entry: dict[str, Any]) -> list[str]:
    from hermes_cli.web_routers.config_env import _models_from_custom_endpoint_entry

    return _models_from_custom_endpoint_entry(entry)


def _api_mode_of(entry: dict[str, Any]) -> str:
    mode = str(entry.get("api_mode") or "").strip().lower()
    return mode if mode in _API_MODES else ""


# ---------------------------------------------------------------------------
# Connection probe (optional pre-flight)
# ---------------------------------------------------------------------------

async def probe(profile: str, endpoint_id: str) -> dict[str, Any]:
    """Probe the source endpoint through the core validate handler (the same
    one the Settings panel's Test button calls). Network goes only to the
    endpoint's own base_url, with its own key."""
    from hermes_cli.web_models import CustomEndpointUpdate
    from hermes_cli.web_routers.config_env import validate_custom_endpoint

    canonical_id, entry, key = source_endpoint(profile, endpoint_id)
    _validate_entry(entry)
    body = CustomEndpointUpdate(
        id=canonical_id,
        name=str(entry.get("name") or canonical_id),
        base_url=str(entry["base_url"]),
        model=str(entry.get("model") or ""),
        api_key=(key or None),
        api_mode=_api_mode_of(entry) or None,
        discover_models=bool(entry.get("discover_models", True)),
    )
    result = await validate_custom_endpoint(body)
    return {"endpoint_id": canonical_id, **result}


# ---------------------------------------------------------------------------
# Duplication
# ---------------------------------------------------------------------------

def _update_body(canonical_id: str, entry: dict[str, Any], key: Optional[str], copy_keys: bool):
    """Build the exact payload the Settings panel would save for this entry."""
    from hermes_cli.web_models import CustomEndpointModelDetail, CustomEndpointUpdate

    models_map = entry.get("models") if isinstance(entry.get("models"), dict) else {}
    model_ids = _models_of(entry)
    default_model = str(entry.get("model") or (model_ids[0] if model_ids else ""))
    details = [
        CustomEndpointModelDetail(
            id=model_id,
            canonical_model=row.get("canonical_model"),
            reasoning_effort=row.get("reasoning_effort"),
        )
        for model_id, row in models_map.items()
        if isinstance(row, dict) and (row.get("canonical_model") or row.get("reasoning_effort"))
    ]
    context_length = entry.get("context_length")
    if not context_length and isinstance(models_map.get(default_model), dict):
        context_length = models_map[default_model].get("context_length")
    return CustomEndpointUpdate(
        id=canonical_id,
        name=str(entry.get("name") or canonical_id),
        base_url=str(entry["base_url"]),
        model=default_model,
        api_key=(key if (copy_keys and key) else None),
        api_mode=_api_mode_of(entry),
        context_length=int(context_length) if context_length else None,
        discover_models=bool(entry.get("discover_models", True)),
        make_default=False,
        models=model_ids or None,
        model_details=details or None,
    )


def _merge_fidelity(target: str, canonical_id: str, source_entry: dict[str, Any]) -> None:
    """Restore the fields the public save payload cannot carry: per-model
    context lengths, extra_headers, request_overrides, TLS settings, …

    The core upsert handler already wrote the entry and decided its credential
    state; this pass merges the remaining NON-credential source fields onto it
    under the same profile scope + config mutation lock the core routes use.
    """
    from hermes_cli.config import load_config, save_config
    from hermes_cli.config_backend import CONFIG_MUTATION_LOCK
    from hermes_cli.web_routers.config_env import _resolve_custom_endpoint_entry
    from hermes_cli.web_server_profiles import _config_profile_scope

    with _config_profile_scope(target), CONFIG_MUTATION_LOCK:
        cfg = load_config()
        providers = cfg.get("providers")
        stored_key, existing = _resolve_custom_endpoint_entry(providers, canonical_id)
        if existing is None or not isinstance(providers, dict):
            return
        merged = dict(existing)
        for field, value in source_entry.items():
            if field in _CREDENTIAL_FIELDS or field in _META_FIELDS:
                continue
            merged[field] = copy.deepcopy(value)
        providers[stored_key] = merged
        cfg["providers"] = providers
        save_config(cfg)


def _verify_target(target: str, canonical_id: str, entry: dict[str, Any], expect_key: bool) -> bool:
    """Read the target back and confirm the endpoint landed as intended."""
    try:
        rows = endpoints(target).get("endpoints", [])
    except Exception:
        return False
    row = next((r for r in rows if r.get("id") == canonical_id), None)
    if row is None:
        return False
    same_url = str(row.get("base_url") or "").rstrip("/") == str(entry.get("base_url") or "").rstrip("/")
    same_model = str(row.get("model") or "") == str(entry.get("model") or "")
    return bool(same_url and same_model and bool(row.get("has_api_key")) == expect_key)


def duplicate(
    source_profile: str,
    endpoint_ids: list[str],
    target_profiles: list[str],
    *,
    copy_keys: bool = True,
    validate_first: bool = False,
    make_default: bool = False,
    on_conflict: str = "update",
) -> dict[str, Any]:
    """Duplicate endpoints from one profile to others, with validation.

    Steps per endpoint: read source (once) → optional connection probe →
    completeness validation → core upsert into each target (credential
    lifecycle included) → fidelity merge → read-back verification → optional
    activation as the target's default model route.

    Never touches a target's ``model`` slot unless ``make_default`` is set.
    Raises ``ValueError`` for invalid requests; per-endpoint/per-target failures
    are reported in ``results`` so one bad endpoint cannot sink the batch.
    """
    from hermes_cli.profiles import profile_exists
    from hermes_cli.web_routers.config_env import activate_custom_endpoint, upsert_custom_endpoint

    endpoint_ids = list(dict.fromkeys(str(e).strip() for e in endpoint_ids if str(e).strip()))
    target_profiles = list(dict.fromkeys(str(t).strip() for t in target_profiles if str(t).strip()))
    if not source_profile or not str(source_profile).strip():
        raise ValueError("source_profile is required")
    source_profile = str(source_profile).strip()
    if not endpoint_ids:
        raise ValueError("select at least one endpoint")
    if not target_profiles:
        raise ValueError("select at least one target profile")
    if source_profile in target_profiles:
        raise ValueError("the source profile cannot be a target")
    if on_conflict not in ("update", "skip"):
        raise ValueError("on_conflict must be 'update' or 'skip'")
    for name in [source_profile, *target_profiles]:
        if not profile_exists(name):
            raise ValueError(f"unknown profile: {name}")

    # 1. Read every source endpoint once (canonical id, full entry, key value).
    sources: dict[str, tuple[str, dict[str, Any], Optional[str]]] = {}
    read_errors: dict[str, str] = {}
    for endpoint_id in endpoint_ids:
        try:
            sources[endpoint_id] = source_endpoint(source_profile, endpoint_id)
        except (LookupError, ValueError) as exc:
            read_errors[endpoint_id] = str(exc)

    # 2. Optional pre-flight connection probe (once per endpoint, not per target).
    probes: dict[str, dict[str, Any]] = {}
    if validate_first and sources:
        import asyncio

        async def _probe_all() -> dict[str, dict[str, Any]]:
            out = {}
            for endpoint_id in sources:
                try:
                    out[endpoint_id] = await probe(source_profile, endpoint_id)
                except Exception as exc:
                    out[endpoint_id] = {"ok": False, "reachable": False, "message": str(exc), "models": []}
            return out

        probes = asyncio.run(_probe_all())

    # 3. Write + verify per target.
    results: list[dict[str, Any]] = []
    for target in target_profiles:
        try:
            pre_rows = {r["id"]: r for r in endpoints(target).get("endpoints", [])}
        except Exception:
            pre_rows = {}
        for endpoint_id in endpoint_ids:
            row: dict[str, Any] = {
                "target": target, "endpoint_id": endpoint_id, "name": endpoint_id,
                "ok": False, "action": None, "key": None, "verified": False,
                "activated": False, "error": None,
            }
            results.append(row)
            if endpoint_id in read_errors:
                row["error"] = read_errors[endpoint_id]
                continue
            canonical_id, entry, key = sources[endpoint_id]
            row["endpoint_id"] = canonical_id
            row["name"] = str(entry.get("name") or canonical_id)
            try:
                _validate_entry(entry)
                if validate_first:
                    probe_result = probes.get(endpoint_id, {})
                    row["probe"] = probe_result
                    if not probe_result.get("ok"):
                        row["error"] = "pre-flight validation failed: " + str(
                            probe_result.get("message") or "endpoint did not answer")
                        continue
                existed = canonical_id in pre_rows
                if existed and on_conflict == "skip":
                    row["action"] = "skipped"
                    row["key"] = "kept" if pre_rows[canonical_id].get("has_api_key") else "absent"
                    row["verified"] = True
                    row["ok"] = True
                    continue
                row["action"] = "updated" if existed else "created"
                upsert_custom_endpoint(_update_body(canonical_id, entry, key, copy_keys), profile=target)
                _merge_fidelity(target, canonical_id, entry)
                if copy_keys:
                    row["key"] = "copied" if key else ("missing" if entry.get("key_env") or entry.get("api_key") else "absent")
                    expect_key = bool(key)
                else:
                    kept = existed and bool(pre_rows[canonical_id].get("has_api_key"))
                    row["key"] = "kept" if kept else "absent"
                    expect_key = kept
                row["verified"] = _verify_target(target, canonical_id, entry, expect_key)
                if make_default:
                    activate_custom_endpoint(canonical_id, profile=target)
                    row["activated"] = True
                row["ok"] = True
            except Exception as exc:
                detail = getattr(exc, "detail", None)
                row["error"] = str(detail or exc)
                _log.warning("bw-duplicate-endpoints: %s -> %s failed for %s: %s",
                             source_profile, target, endpoint_id, exc)

    succeeded = sum(1 for r in results if r["ok"])
    return {
        "ok": succeeded == len(results),
        "source_profile": source_profile,
        "results": results,
        "summary": {
            "endpoints": len(endpoint_ids), "targets": len(target_profiles),
            "succeeded": succeeded, "failed": len(results) - succeeded,
        },
    }


# ---------------------------------------------------------------------------
# Profile management (read-mostly; every write uses Hermes' own writers)
# ---------------------------------------------------------------------------

def plugin_enabled(profile: str) -> bool:
    """Whether this plugin is in the profile's enabled allow-list (and not disabled)."""
    from hermes_cli.config import load_config
    from hermes_cli.web_server_profiles import _config_profile_scope

    with _config_profile_scope(profile):
        plugins_cfg = load_config().get("plugins") or {}
        enabled = plugins_cfg.get("enabled") or []
        disabled = plugins_cfg.get("disabled") or []
        return PLUGIN_ID in enabled and PLUGIN_ID not in disabled


def profiles_overview() -> dict[str, Any]:
    """Rich profile cards: Hermes' own ProfileInfo + endpoint inventory +
    this plugin's per-profile enable state. A broken profile reports its error
    instead of sinking the page."""
    from hermes_cli.profiles import list_profiles

    rows: list[dict[str, Any]] = []
    for info in list_profiles(lazy_skill_count=True):
        row: dict[str, Any] = {
            "name": info.name,
            "display_name": info.display_name or "",
            "description": info.description or "",
            "description_auto": bool(info.description_auto),
            "home": str(info.path),
            "is_default": info.is_default,
            "gateway_running": bool(info.gateway_running),
            "model": info.model,
            "provider": info.provider,
            "has_env": bool(info.has_env),
            "skill_count": int(info.skill_count or 0),
            "alias_name": info.alias_name,
            "endpoints": [],
            "endpoint_count": 0,
            "key_count": 0,
            "current": None,
            "plugin_enabled": False,
            "error": None,
        }
        try:
            data = endpoints(info.name)
            row["endpoints"] = data.get("endpoints", [])
            row["endpoint_count"] = len(row["endpoints"])
            row["key_count"] = sum(1 for e in row["endpoints"] if e.get("has_api_key"))
            row["current"] = data.get("current")
        except Exception as exc:
            row["error"] = str(exc)
        try:
            row["plugin_enabled"] = plugin_enabled(info.name)
        except Exception:
            pass
        rows.append(row)
    return {"plugin": PLUGIN_ID, "version": VERSION, "profiles": rows}


def set_profile_meta(
    profile: str,
    display_name: Optional[str] = None,
    description: Optional[str] = None,
) -> dict[str, Any]:
    """Edit a profile's presentation metadata through Hermes' canonical writer
    (``write_profile_meta``: atomic, preserves every other profile.yaml field).
    Editing the description confirms it (clears the auto-generated flag)."""
    from hermes_cli.profiles import get_profile_dir, profile_exists, read_profile_meta, write_profile_meta

    if not profile_exists(profile):
        raise ValueError(f"unknown profile: {profile}")
    if display_name is None and description is None:
        raise ValueError("nothing to update")
    if display_name is not None and len(display_name.strip()) > 64:
        raise ValueError("display name is limited to 64 characters")
    if description is not None and len(description.strip()) > 500:
        raise ValueError("description is limited to 500 characters")
    home = get_profile_dir(profile)
    write_profile_meta(
        home,
        display_name=display_name,
        description=description,
        description_auto=False if description is not None else None,
    )
    meta = read_profile_meta(home)
    return {"profile": profile, "display_name": meta["display_name"], "description": meta["description"]}


def set_plugin_enabled(profile: str, enabled: bool) -> dict[str, Any]:
    """Enable/disable this plugin's backend for one profile through the same
    admission transaction the CLI and Dashboard toggles use (versioned,
    kill-list checked). The launch profile mounts backend routes at startup,
    so a gateway restart may be needed before the change is served."""
    from hermes_cli.profiles import profile_exists
    from hermes_cli.web_server_profiles import _config_profile_scope

    if not profile_exists(profile):
        raise ValueError(f"unknown profile: {profile}")
    from hermes_cli import plugins_cmd

    with _config_profile_scope(profile):
        plugins_cmd._set_plugin_enabled(PLUGIN_ID, enable=bool(enabled))
        state = plugin_enabled(profile)
    return {"profile": profile, "plugin_enabled": state, "restart_may_be_required": True}


def activate(profile: str, endpoint_id: str) -> dict[str, Any]:
    """Make one endpoint the profile's default model route (core handler)."""
    from hermes_cli.web_routers.config_env import activate_custom_endpoint

    return activate_custom_endpoint(endpoint_id, profile=profile)


def create_endpoint(
    name: str,
    base_url: str,
    model: str,
    profiles: list[str],
    *,
    endpoint_id: str = "",
    api_key: Optional[str] = None,
    api_mode: str = "",
    context_length: Optional[int] = None,
    discover_models: bool = True,
    make_default: bool = False,
) -> dict[str, Any]:
    """Create one endpoint on several profiles at once (the plugin's own
    multi-profile creation form). Each write goes through the core upsert
    handler — same validation, credential lifecycle and locks as Settings.
    The key value is stored by Hermes per profile and never returned."""
    from hermes_cli.profiles import profile_exists
    from hermes_cli.web_models import CustomEndpointUpdate
    from hermes_cli.web_routers.config_env import activate_custom_endpoint, upsert_custom_endpoint

    name = str(name or "").strip()
    base_url = str(base_url or "").strip().rstrip("/")
    model = str(model or "").strip()
    profiles = list(dict.fromkeys(str(p).strip() for p in profiles if str(p).strip()))
    if not name:
        raise ValueError("name is required")
    if not base_url:
        raise ValueError("base_url is required")
    try:
        parsed = urllib.parse.urlparse(base_url)
    except ValueError as exc:
        raise ValueError("base_url must include scheme and host") from exc
    if not parsed.scheme or not parsed.netloc:
        raise ValueError("base_url must include scheme and host")
    if not model:
        raise ValueError("model is required")
    if not profiles:
        raise ValueError("select at least one profile")
    for profile in profiles:
        if not profile_exists(profile):
            raise ValueError(f"unknown profile: {profile}")
    if api_mode and api_mode not in _API_MODES:
        raise ValueError("invalid api_mode")
    key_value = str(api_key).strip() if api_key is not None else ""

    results: list[dict[str, Any]] = []
    for profile in profiles:
        row: dict[str, Any] = {
            "profile": profile, "ok": False, "endpoint_id": None, "action": None,
            "key": None, "verified": False, "activated": False, "error": None,
        }
        results.append(row)
        try:
            pre_rows = {r["id"]: r for r in endpoints(profile).get("endpoints", [])}
            fields = {
                "id": str(endpoint_id or "").strip() or name,
                "name": name,
                "base_url": base_url,
                "model": model,
                "api_mode": api_mode or "",
                "context_length": int(context_length) if context_length else None,
                "discover_models": bool(discover_models),
                "make_default": False,
            }
            fields["api_key"] = key_value or None
            body = CustomEndpointUpdate(**fields)
            response = upsert_custom_endpoint(body, profile=profile)
            canonical_id = str(response.get("id") or "")
            row["endpoint_id"] = canonical_id
            row["action"] = "updated" if canonical_id in pre_rows else "created"
            row["key"] = "copied" if key_value else "absent"
            row["verified"] = _verify_target(
                profile, canonical_id,
                {"name": name, "base_url": base_url, "model": model},
                bool(key_value),
            )
            if make_default:
                activate_custom_endpoint(canonical_id, profile=profile)
                row["activated"] = True
            row["ok"] = True
        except Exception as exc:
            row["error"] = str(getattr(exc, "detail", None) or exc)
            _log.warning("bw-duplicate-endpoints: create on %s failed: %s", profile, exc)

    succeeded = sum(1 for r in results if r["ok"])
    return {
        "ok": succeeded == len(results),
        "results": results,
        "summary": {"profiles": len(profiles), "succeeded": succeeded, "failed": len(results) - succeeded},
    }
