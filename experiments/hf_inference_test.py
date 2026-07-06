"""Quick HF inference test via router.huggingface.co."""
import os, json, urllib.request, urllib.error

TOKEN = os.environ.get("HF_TOKEN", "")
if not TOKEN:
    raise SystemExit("HF_TOKEN env var not set")

# --- models ---
# HF router only supports /v1/chat/completions.
# Mistral instruct models (7B/Nemo/Mixtral) are classified as non-chat by the router.
# Working chat models: XiaomiMiMo/MiMo-V2.5-Pro, meta-llama/Llama-3.1-8B-Instruct, etc.

MODELS = [
    "meta-llama/Llama-3.1-8B-Instruct",
    "Qwen/Qwen2.5-7B-Instruct",
    "mistralai/Mistral-7B-Instruct-v0.3",
    "XiaomiMiMo/MiMo-V2.5-Pro",
]

for model in MODELS:
    body = json.dumps({
        "model": model,
        "messages": [{"role": "user", "content": "Say hello in one word."}],
        "max_tokens": 16,
        "stream": False,
    }).encode()

    req = urllib.request.Request(
        "https://router.huggingface.co/v1/chat/completions",
        data=body,
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read())
            content = data["choices"][0]["message"]["content"].strip()
            print(f"[OK]   {model}: {content}")
    except urllib.error.HTTPError as e:
        err_body = e.read().decode()
        print(f"[FAIL] {model}: HTTP {e.code} - {err_body[:80]}")
    except Exception as exc:
        print(f"[ERR]  {model}: {exc}")