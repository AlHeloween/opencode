"""Verify the OpenRouter GLM-5.3-Flash model id and its image-input support.

Two things must be true before the comparison test is meaningful:
  1. the exact model slug exists on OpenRouter;
  2. it declares image input - otherwise the test cannot run at all.

Reads the key from bin/auth.json (length only is ever printed).

Run: python experiments/2026-09-12_deepseek-vision/check-glm-openrouter.py
"""

from __future__ import annotations

import json
import pathlib
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
DIR = pathlib.Path(__file__).resolve().parent
OUT = DIR / "glm-openrouter-info.json"

CANDIDATES = ["z-ai/glm-5.3-flash", "zai/glm-5.3-flash", "z-ai/glm-5.3"]


def load_key() -> str:
    auth = json.loads((ROOT / "bin" / "auth.json").read_text(encoding="utf-8"))
    entry = auth.get("openrouter") or {}
    key = entry.get("key") or entry.get("apiKey") or entry.get("token")
    if not key:
        raise SystemExit("no openrouter key in bin/auth.json")
    return str(key).strip()


def main() -> None:
    key = load_key()
    print(f"openrouter key present, length {len(key)}")

    request = urllib.request.Request(
        "https://openrouter.ai/api/v1/models",
        headers={"authorization": f"Bearer {key}", "user-agent": "opencode-glm-check"},
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        OUT.write_text(json.dumps({"error": f"HTTP {error.code}: {error.read().decode('utf-8', 'replace')[:300]}"}, indent=2), encoding="utf-8")
        print("models endpoint failed")
        return

    models = payload.get("data") or []
    print(f"openrouter models listed: {len(models)}")

    found = []
    for model in models:
        slug = model.get("id") or ""
        if "glm" not in slug.lower():
            continue
        if "5.3" not in slug and "5-3" not in slug:
            continue
        modalities = model.get("architecture", {}).get("input_modalities") or []
        pricing = model.get("pricing") or {}
        found.append(
            {
                "id": slug,
                "name": model.get("name"),
                "input_modalities": modalities,
                "supports_image": "image" in modalities,
                "context_length": model.get("context_length"),
                "pricing": {k: pricing.get(k) for k in ("prompt", "completion", "input_cache_read") if k in pricing},
            }
        )

    # prefer the exact slug the user asked for
    exact = [m for m in found if m["id"] in CANDIDATES]
    report = {
        "requested": CANDIDATES,
        "exact_matches": exact,
        "all_glm_53": sorted(found, key=lambda m: m["id"]),
    }
    OUT.write_text(json.dumps(report, indent=2), encoding="utf-8")

    print("")
    print("exact matches:")
    for m in exact:
        print(f"  {m['id']:34} image={m['supports_image']} ctx={m['context_length']} modalities={m['input_modalities']}")
    print("")
    print(f"all glm-5.3 slugs: {len(found)}; written to {OUT.name}")


if __name__ == "__main__":
    main()
