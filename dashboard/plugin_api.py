"""BeeWorks Duplicate Endpoints — backend API routes.

Mounted by the Hermes web server at ``/api/plugins/bw-duplicate-endpoints/``
once the plugin is in ``plugins.enabled``. Thin HTTP layer over
``bw_duplicate_endpoints_core``; all profile scoping, config writes and
credential handling live in the core module and in Hermes' own routes.

Routes:
    GET  /health      liveness + version (the Desktop page probes this first)
    GET  /overview    every profile with its custom endpoints (masked)
    GET  /endpoints   one profile's endpoints (?profile=<name>)
    POST /probe       connection test of one source endpoint (core validate)
    POST /duplicate   validated, confirmed-by-UI batch duplication
"""

from __future__ import annotations

import importlib.util
import logging
import sys
from pathlib import Path
from typing import NoReturn, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

_log = logging.getLogger(__name__)
router = APIRouter()

_CORE_MODULE = "bw_duplicate_endpoints_dashboard_core"


def _core():
    """The sibling core module, loaded by path (the host imports this file via
    ``spec_from_file_location`` with no package, so relative imports are out)."""
    mod = sys.modules.get(_CORE_MODULE)
    if mod is not None:
        return mod
    path = Path(__file__).with_name("bw_duplicate_endpoints_core.py")
    spec = importlib.util.spec_from_file_location(_CORE_MODULE, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[_CORE_MODULE] = mod
    try:
        spec.loader.exec_module(mod)
    except Exception:
        sys.modules.pop(_CORE_MODULE, None)
        raise
    return mod


def _fail(exc: Exception) -> NoReturn:
    """Map core failures to HTTP: request problems 400, missing things 404,
    core HTTPException verbatim, anything else logged + 500."""
    if isinstance(exc, HTTPException):
        raise exc
    if isinstance(exc, LookupError):
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if isinstance(exc, ValueError):
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    _log.exception("bw-duplicate-endpoints: unexpected failure")
    raise HTTPException(status_code=500, detail="Internal server error") from exc


class ProbeBody(BaseModel):
    profile: str = Field(min_length=1)
    endpoint_id: str = Field(min_length=1)


class DuplicateBody(BaseModel):
    source_profile: str = Field(min_length=1)
    endpoint_ids: list[str] = Field(min_length=1)
    target_profiles: list[str] = Field(min_length=1)
    copy_keys: bool = True
    validate_first: bool = False
    make_default: bool = False
    on_conflict: str = Field(default="update", pattern="^(update|skip)$")


class ProfileMetaBody(BaseModel):
    profile: str = Field(min_length=1)
    display_name: Optional[str] = None
    description: Optional[str] = None


class PluginToggleBody(BaseModel):
    profile: str = Field(min_length=1)
    enabled: bool


class ActivateBody(BaseModel):
    profile: str = Field(min_length=1)
    endpoint_id: str = Field(min_length=1)


class CreateBody(BaseModel):
    name: str = Field(min_length=1)
    base_url: str = Field(min_length=1)
    model: str = Field(min_length=1)
    profiles: list[str] = Field(min_length=1)
    endpoint_id: str = ""
    api_key: Optional[str] = None
    api_mode: str = Field(default="", pattern="^(|chat_completions|codex_responses|anthropic_messages)$")
    context_length: Optional[int] = None
    discover_models: bool = True
    make_default: bool = False


@router.get("/health")
def health() -> dict:
    core = _core()
    return {"ok": True, "plugin": core.PLUGIN_ID, "version": core.VERSION}


@router.get("/overview")
def get_overview() -> dict:
    try:
        return _core().overview()
    except Exception as exc:
        _fail(exc)


@router.get("/endpoints")
def get_endpoints(profile: Optional[str] = None) -> dict:
    try:
        return _core().endpoints(profile)
    except Exception as exc:
        _fail(exc)


@router.post("/probe")
async def post_probe(body: ProbeBody) -> dict:
    try:
        return await _core().probe(body.profile, body.endpoint_id)
    except Exception as exc:
        _fail(exc)


@router.post("/duplicate")
def post_duplicate(body: DuplicateBody) -> dict:
    try:
        return _core().duplicate(
            body.source_profile,
            body.endpoint_ids,
            body.target_profiles,
            copy_keys=body.copy_keys,
            validate_first=body.validate_first,
            make_default=body.make_default,
            on_conflict=body.on_conflict,
        )
    except Exception as exc:
        _fail(exc)


@router.get("/profiles")
def get_profiles() -> dict:
    try:
        return _core().profiles_overview()
    except Exception as exc:
        _fail(exc)


@router.post("/profiles/meta")
def post_profile_meta(body: ProfileMetaBody) -> dict:
    try:
        return _core().set_profile_meta(body.profile, body.display_name, body.description)
    except Exception as exc:
        _fail(exc)


@router.post("/profiles/plugin")
def post_profile_plugin(body: PluginToggleBody) -> dict:
    try:
        return _core().set_plugin_enabled(body.profile, body.enabled)
    except Exception as exc:
        _fail(exc)


@router.post("/profiles/activate")
def post_profile_activate(body: ActivateBody) -> dict:
    try:
        return _core().activate(body.profile, body.endpoint_id)
    except Exception as exc:
        _fail(exc)


@router.post("/create")
def post_create(body: CreateBody) -> dict:
    try:
        options = {
            "endpoint_id": body.endpoint_id,
            "api_mode": body.api_mode,
            "context_length": body.context_length,
            "discover_models": body.discover_models,
            "make_default": body.make_default,
        }
        options["api_key"] = body.api_key
        return _core().create_endpoint(body.name, body.base_url, body.model, body.profiles, **options)
    except Exception as exc:
        _fail(exc)
