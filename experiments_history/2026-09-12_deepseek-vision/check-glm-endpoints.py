"""Which OpenRouter endpoints serve z-ai/glm-5.3-flash, and does the z.ai one take images?

Provider pinning needs the exact provider slug, and the pin is only sound if that specific
endpoint declares image input. The model-level modality list is not enough: a model can be
multi-modal overall while the pinned endpoint is text-only.

Run: python experiments/2026-09-12_deepseek-vision/check-glm-endpoints.py
"""

from __future__ import annotations

import json
import pathlib
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
DIR = pathlib.Path(__file__).resolve().parent
OUT = DIR / "glm-endpoints.json"
SLUG = "z-ai/glm-5.3-flash"


def load_key() -> str:
    auth = json.loads((ROOT / "bin" / "auth.json").read_text(encoding="utf-8"))
    entry = auth.get("openrouter") or {}
    key = entry.get("key") or entry.get("apiKey") or entry.get("token")
    if not key:
        raise SystemExit("no openrouter key")
    return str(key).strip()


def main() -> None:
    key = load_key()
    url = f"https://openrouter.ai/api/v1/models/{SLUG}/endpoints"
    request = urllib.request.Request(url, headers={"authorization": f"Bearer {key}", "user-agent": "opencode-glm-endpoints"})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        print(f"HTTP {error.code}: {error.read().decode('utf-8', 'replace')[:300]}")
        return

    data = payload.get("data") or {}
    endpoints = data.get("endpoints") or []

    rows = []
    for endpoint in endpoints:
        rows.append(
            {
                "provider": endpoint.get("provider_name"),
                "tag": endpoint.get("tag"),
                "name": endpoint.get("name"),
                "context_length": endpoint.get("context_length"),
                "quantization": endpoint.get("quantization"),
                "max_completion_tokens": endpoint.get("max_completion_tokens"),
                "modalities": endpoint.get("modalities") or endpoint.get("architecture", {}).get("input_modalities"),
                "supports_image": "image"
                in (endpoint.get("modalities") or endpoint.get("architecture", {}).get("input_modalities") or []),
                "pricing": endpoint.get("pricing"),
            }
        )

    report = {"slug": SLUG, "model_name": data.get("name"), "endpoint_count": len(rows), "endpoints": rows}
    OUT.write_text(json.dumps(report, indent=2), encoding="utf-8")

    print(f"slug: {SLUG} ({data.get('name')})")
    print(f"endpoints: {len(rows)}")
    print("")
    print(f"{'provider':22} {'tag':28} {'image':6} {'ctx':>9} {'quant':>10}")
    print("-" * 80)
    for row in rows:
        print(
            f"{str(row['provider'])[:22]:22} {str(row['tag'])[:28]:28} "
            f"{str(row['supports_image']):6} {str(row['context_length']):>9} {str(row['quantization']):>10}"
        )
    print("")
    print(f"written to {OUT.name}")


if __name__ == "__main__":
    main()
