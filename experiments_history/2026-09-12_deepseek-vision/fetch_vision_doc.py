"""Fetch the DeepSeek vision guide and reduce it to plain text.

Why a file instead of `python -c`: this console swallows inline python output,
and a silent empty result would be mistaken for "the doc says nothing".

Writes (relative to repo root):
  experiments/2026-09-12_deepseek-vision/vision-doc.html
  experiments/2026-09-12_deepseek-vision/vision-doc.txt

Run: python experiments/2026-09-12_deepseek-vision/fetch_vision_doc.py
"""

from __future__ import annotations

import pathlib
import re
import urllib.request

URL = "https://api-docs.deepseek.com/guides/vision"
DIR = pathlib.Path("experiments/2026-09-12_deepseek-vision")
HTML = DIR / "vision-doc.html"
TXT = DIR / "vision-doc.txt"

ENTITIES = {
    "&nbsp;": " ",
    "&amp;": "&",
    "&quot;": '"',
    "&#x27;": "'",
    "&#39;": "'",
    "&lt;": "<",
    "&gt;": ">",
}


def fetch() -> str:
    request = urllib.request.Request(
        URL,
        headers={"User-Agent": "Mozilla/5.0 (compatible; opencode-vision-probe)"},
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read().decode("utf-8", "replace")


def strip_html(html: str) -> str:
    text = re.sub(r"(?is)<(script|style|nav|footer|head)[^>]*>.*?</\1>", "\n", html)
    text = re.sub(r"(?is)</(p|div|li|tr|h[1-6]|pre|code)>", "\n", text)
    text = re.sub(r"(?s)<[^>]+>", "", text)
    for entity, char in ENTITIES.items():
        text = text.replace(entity, char)
    text = re.sub(r"&#x?[0-9a-fA-F]+;", " ", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n\s*\n+", "\n", text)
    return text.strip()


def main() -> None:
    DIR.mkdir(parents=True, exist_ok=True)
    try:
        html = fetch()
    except Exception as error:  # noqa: BLE001 - the failure is the evidence
        TXT.write_text(f"fetch failed: {error}\n", encoding="utf-8")
        return

    HTML.write_text(html, encoding="utf-8")
    text = strip_html(html)
    header = f"source={URL}\nhtml_bytes={len(html)}\ntext_chars={len(text)}\n"
    TXT.write_text(header + "\n" + text, encoding="utf-8")


if __name__ == "__main__":
    main()
