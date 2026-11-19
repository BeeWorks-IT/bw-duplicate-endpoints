"""BeeWorks Duplicate Endpoints — Hermes Agent plugin.

The feature is a Desktop settings page (``desktop/plugin.js``) backed by a
dashboard API (``dashboard/manifest.json`` + ``dashboard/plugin_api.py``); the
web server mounts the backend once this plugin is in ``plugins.enabled``.
``register()`` exists so the plugin has the standard loader surface and can be
listed/enabled with ``hermes plugins``; it registers no tools or hooks.
"""

from __future__ import annotations


def register(ctx) -> None:  # noqa: ARG001 — nothing to register for a UI-only plugin
    return None
