"""Router tests driven through FastAPI's TestClient, mounted at the host prefix."""

from __future__ import annotations

import pytest

from conftest import SOURCE_SECRET


@pytest.fixture
def client(fleet, plugin_api):
    from fastapi import FastAPI
    from starlette.testclient import TestClient

    app = FastAPI()
    app.include_router(plugin_api.router, prefix="/api/plugins/bw-duplicate-endpoints")
    return TestClient(app)


PREFIX = "/api/plugins/bw-duplicate-endpoints"


def test_health(client):
    resp = client.get(f"{PREFIX}/health")
    assert resp.status_code == 200
    assert resp.json()["ok"] is True
    assert resp.json()["plugin"] == "bw-duplicate-endpoints"


def test_overview(client):
    resp = client.get(f"{PREFIX}/overview")
    assert resp.status_code == 200
    names = [p["name"] for p in resp.json()["profiles"]]
    assert {"default", "alpha", "beta"} <= set(names)
    assert SOURCE_SECRET not in resp.text


def test_endpoints_scoped(client):
    resp = client.get(f"{PREFIX}/endpoints", params={"profile": "alpha"})
    assert resp.status_code == 200
    assert len(resp.json()["endpoints"]) == 2
    resp = client.get(f"{PREFIX}/endpoints", params={"profile": "beta"})
    assert resp.json()["endpoints"] == []


def test_duplicate_happy_path(client):
    listing = client.get(f"{PREFIX}/endpoints", params={"profile": "alpha"}).json()
    endpoint_id = next(e["id"] for e in listing["endpoints"] if e["has_api_key"])
    resp = client.post(f"{PREFIX}/duplicate", json={
        "source_profile": "alpha", "endpoint_ids": [endpoint_id],
        "target_profiles": ["beta"], "copy_keys": True,
    })
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["ok"] and data["results"][0]["verified"]
    assert SOURCE_SECRET not in resp.text
    after = client.get(f"{PREFIX}/endpoints", params={"profile": "beta"}).json()
    assert any(e["id"] == endpoint_id and e["has_api_key"] for e in after["endpoints"])


def test_duplicate_validation_errors(client):
    resp = client.post(f"{PREFIX}/duplicate", json={
        "source_profile": "alpha", "endpoint_ids": ["local-lab"], "target_profiles": ["alpha"],
    })
    assert resp.status_code == 400
    resp = client.post(f"{PREFIX}/duplicate", json={
        "source_profile": "alpha", "endpoint_ids": [], "target_profiles": ["beta"],
    })
    assert resp.status_code == 422  # pydantic min_length
    resp = client.post(f"{PREFIX}/duplicate", json={
        "source_profile": "alpha", "endpoint_ids": ["local-lab"], "target_profiles": ["no-such"],
    })
    assert resp.status_code == 400


def test_probe_unknown_endpoint_404(client):
    resp = client.post(f"{PREFIX}/probe", json={"profile": "alpha", "endpoint_id": "ghost"})
    assert resp.status_code == 404


def test_profiles_routes(client):
    resp = client.get(f"{PREFIX}/profiles")
    assert resp.status_code == 200
    alpha = next(p for p in resp.json()["profiles"] if p["name"] == "alpha")
    assert alpha["endpoint_count"] == 2
    assert SOURCE_SECRET not in resp.text

    resp = client.post(f"{PREFIX}/profiles/meta", json={
        "profile": "alpha", "display_name": "Atelier", "description": "Test"})
    assert resp.status_code == 200
    assert resp.json()["display_name"] == "Atelier"

    resp = client.post(f"{PREFIX}/profiles/plugin", json={"profile": "beta", "enabled": True})
    assert resp.status_code == 200
    assert resp.json()["plugin_enabled"] is True

    resp = client.post(f"{PREFIX}/profiles/meta", json={"profile": "ghost"})
    assert resp.status_code == 400


def test_activate_route(client):
    client.post(f"{PREFIX}/duplicate", json={
        "source_profile": "alpha", "endpoint_ids": ["local-lab"], "target_profiles": ["beta"]})
    resp = client.post(f"{PREFIX}/profiles/activate", json={"profile": "beta", "endpoint_id": "local-lab"})
    assert resp.status_code == 200
    assert resp.json()["ok"] is True
    resp = client.post(f"{PREFIX}/profiles/activate", json={"profile": "beta", "endpoint_id": "ghost"})
    assert resp.status_code == 404


def test_duplicate_skip_conflict(client):
    payload = {"source_profile": "alpha", "endpoint_ids": ["local-lab"], "target_profiles": ["beta"]}
    assert client.post(f"{PREFIX}/duplicate", json=payload).status_code == 200
    resp = client.post(f"{PREFIX}/duplicate", json={**payload, "on_conflict": "skip"})
    assert resp.status_code == 200
    assert resp.json()["results"][0]["action"] == "skipped"
    resp = client.post(f"{PREFIX}/duplicate", json={**payload, "on_conflict": "bogus"})
    assert resp.status_code == 422


def test_create_route(client):
    resp = client.post(f"{PREFIX}/create", json={
        "name": "My API", "base_url": "https://api.example.com/v1", "model": "m1",
        "profiles": ["beta"], "api_key": "fixture-route-key-000",
    })
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["ok"] and data["results"][0]["verified"]
    assert "fixture-route-key-000" not in resp.text
    after = client.get(f"{PREFIX}/endpoints", params={"profile": "beta"}).json()
    assert any(e["id"] == "my-api" and e["has_api_key"] for e in after["endpoints"])


def test_create_route_validation(client):
    resp = client.post(f"{PREFIX}/create", json={
        "name": "X", "base_url": "https://x.example/v1", "model": "m", "profiles": []})
    assert resp.status_code == 422
    resp = client.post(f"{PREFIX}/create", json={
        "name": "X", "base_url": "not-a-url", "model": "m", "profiles": ["beta"]})
    assert resp.status_code == 400
    resp = client.post(f"{PREFIX}/create", json={
        "name": "X", "base_url": "https://x.example/v1", "model": "m",
        "profiles": ["beta"], "api_mode": "bogus"})
    assert resp.status_code == 422
