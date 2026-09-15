"""Locate the GLM model id and the OpenRouter key, without printing secrets.

Writes a small report next to this script:
  - which providers exist in bin/auth.json and which of them carry a key (LENGTH ONLY)
  - every GLM-ish model id in the cached catalog, with modalities and reasoning options

Run: python experiments/2026-09-12_deepseek-vision/find-glm.py
"""

from __future__ import annotations

import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = pathlib.Path(__file__).resolve().parent / "glm-lookup.json"

report: dict = {}

# --- auth: provider names and key lengths only, never values -----------------
try:
    auth = json.loads((ROOT / "bin" / "auth.json").read_text(encoding="utf-8"))
    report["auth_providers"] = sorted(auth.keys())
    report["auth_keys"] = {}
    for provider, value in auth.items():
        if not isinstance(value, dict):
            continue
        for field, val in value.items():
            if "key" in field.lower() or "token" in field.lower():
                report["auth_keys"][f"{provider}.{field}"] = len(str(val)) if val else 0
except Exception as error:  # noqa: BLE001
    report["auth_error"] = str(error)

# --- catalog: GLM-family models -------------------------------------------------
try:
    catalog = json.loads((ROOT / ".opencode/data/cache/models.json").read_text(encoding="utf-8"))
    hits = []
    for provider_id, provider in catalog.items():
        for model_id, model in (provider.get("models") or {}).items():
            haystack = f"{provider_id}/{model_id}".lower()
            if "glm" not in haystack:
                continue
            hits.append(
                {
                    "provider": provider_id,
                    "model": model_id,
                    "npm": provider.get("npm"),
                    "api": provider.get("api"),
                    "modalities": model.get("modalities"),
                    "reasoning_options": model.get("reasoning_options"),
                    "limit": model.get("limit"),
                }
            )
    report["glm_models"] = hits
except Exception as error:  # noqa: BLE001
    report["catalog_error"] = str(error)

OUT.write_text(json.dumps(report, indent=2), encoding="utf-8")
print(f"wrote {OUT}")
print(f"auth providers: {report.get('auth_providers')}")
print(f"glm models found: {len(report.get('glm_models', []))}")
