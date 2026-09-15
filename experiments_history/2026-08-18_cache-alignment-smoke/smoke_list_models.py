"""List available models via StreamLake correct API format."""
from __future__ import annotations

import json
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[2]
BASE_URL = "https://vanchin.streamlake.ai/api/gateway/v1/endpoints"


def load_key() -> str:
    key = (json.loads((ROOT / "bin" / "auth.json").read_text(encoding="utf-8")).get("pasha-coder") or {}).get("key") or ""
    if not key:
        raise SystemExit("no pasha-coder key")
    return key


def main() -> None:
    api_key = load_key()
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

    # Try /models endpoint
    print("=== GET /models ===\n")
    try:
        resp = httpx.get(f"{BASE_URL}/models", headers=headers, timeout=10)
        print(f"Status: {resp.status_code}")
        data = resp.json()
        print(f"Response: {json.dumps(data, indent=2, ensure_ascii=False)[:3000]}")
    except Exception as e:
        print(f"ERROR: {type(e).__name__}: {e}")

    # Try /v1/models (OpenAI compatible)
    print("\n=== GET /v1/models ===\n")
    try:
        resp = httpx.get(f"{BASE_URL}/v1/models", headers=headers, timeout=10)
        print(f"Status: {resp.status_code}")
        data = resp.json()
        print(f"Response: {json.dumps(data, indent=2, ensure_ascii=False)[:3000]}")
    except Exception as e:
        print(f"ERROR: {type(e).__name__}: {e}")

    # Try OpenAI SDK
    print("\n=== OpenAI SDK ===\n")
    try:
        from openai import OpenAI
        client = OpenAI(base_url=BASE_URL, api_key=api_key)
        models = client.models.list()
        print(f"Found {len(models.data)} models:")
        for m in models.data:
            print(f"  - {m.id}")
    except Exception as e:
        print(f"ERROR: {type(e).__name__}: {str(e)[:300]}")


if __name__ == "__main__":
    main()
