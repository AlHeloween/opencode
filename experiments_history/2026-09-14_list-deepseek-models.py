"""List models exposed by the authenticated DeepSeek API without logging credentials."""
from __future__ import annotations

import os

import requests

API_URL = "https://api.deepseek.com/models"


def main() -> None:
    api_key = os.environ.get("DEEPSEEK_API_KEY")
    if not api_key:
        raise SystemExit("DEEPSEEK_API_KEY is not available to this process")

    response = requests.get(
        API_URL,
        headers={"Authorization": f"Bearer {api_key}"},
        timeout=30,
    )
    response.raise_for_status()
    models = response.json().get("data", [])

    if not isinstance(models, list):
        raise SystemExit("DeepSeek /models response has no data list")

    model_ids: list[str] = []
    for item in models:
        if isinstance(item, dict):
            model_id = item.get("id")
            if isinstance(model_id, str):
                model_ids.append(model_id)

    print(f"DeepSeek /models: {len(model_ids)} model(s)")
    for model_id in sorted(model_ids):
        print(model_id)


if __name__ == "__main__":
    main()
