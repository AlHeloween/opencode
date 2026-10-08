# OpenRouter Files API probe (2026-10-08)

Finding: OpenRouter HAS a live Files API (beta) — upload once, address by `or_file_...`.
Its chat content types document images ONLY as `image_url` (URL | data URI); a `file_id` field
exists on the chat `file` part in `@openrouter/ai-sdk-provider` types ("for OpenAI file uploads
support"). Whether a workspace id (`or_file_...`) addresses an IMAGE in chat is UNVERIFIED:
every chat call with the owner's key returned `403 Key limit exceeded (total limit)`.
Upload/delete are not metered and did answer.

## Receipts (all live, 2026-10-08)

| file | what | result |
|---|---|---|
| `or-upload.json` | `POST /api/v1/files`, multipart `file`=red.png (168 B) | 200; `id=or_file_0VXRBV3gR5XElMkjku9FHjhD`, `mime_type=image/png`, `downloadable=false` |
| `or-delete.json` | `DELETE /api/v1/files/<id>` | 200 `{"type":"file_deleted"}` |
| `probe-A_gemma_control.json` | gemma-3-4b-it + `image_url` data URI | 403 Key limit exceeded |
| `probe-B_gemma_fileid.json` | gemma-3-4b-it + `file.file_id` | 403 Key limit exceeded |
| `probe-C_nano_control.json` | gpt-5-nano + `image_url` data URI | 403 Key limit exceeded |
| `probe-D_nano_fileid.json` | gpt-5-nano + `file.file_id` | 403 Key limit exceeded |

Also probed: `GET /api/v1/files` without auth → 401 (route live). Zen: `GET https://opencode.ai/zen/v1/files` → 404 (no files route).

## Rerun

```
python orprobe.py        # needs OPENROUTER_API_KEY with headroom
```

The script dumps raw responses to `probe-*.json`. Control (C) must answer "red" before the
file_id case (D) means anything.

## Docs read (primary, via the search service reader)

- `https://openrouter.ai/docs/guides/features/files-api` — limits (100 MiB/file, 10 GiB/workspace,
  no expiry, global endpoint only), download rules, accepted types, `provider=openai|anthropic`
  passthrough (BYOK).
- `.../multimodal/overview`, `.../multimodal/image-understanding`, `.../multimodal/pdfs` —
  content parts: `image_url`, `file` (`file_data`), `input_audio`, `video_url`; PDF parsing
  annotations carry a `hash` for skip-parsing.
- `https://raw.githubusercontent.com/OpenRouterTeam/ai-sdk-provider/main/src/types/openrouter-chat-completions-input.ts`
  — `ChatCompletionContentPartFile { filename?, file_data?, file_id? }`.

## Scripts

- `mkpng.py` — stdlib-only 64×64 red PNG writer (the probe payload).
- `orprobe.py` — four chat probes (A–D), dumps raw responses next to itself. It builds `"role": "user"` request bodies, which the archive canon's conversation-turns regex excludes from the tracked tree — it stays in the gitignored `experiments/` copy; rerun it there. `red.png` is likewise untracked (.png is a heavy extension in the canon); `python mkpng.py` regenerates it.
