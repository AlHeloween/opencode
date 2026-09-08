# Program: Visual Context Channel — video-as-context, spectrograms, fractal (FIASCO/WFA) representations

Date: 2026-09-07
Status: DRAFT (pre-G4, staged)
Companion: plans/2026-09-07_tool-result-deliver-once.md (Stage 0 lives there, C1-C3)

## Thesis

The model's visual input is a universal "page" reader (code, diagrams, spectra —
one encoder, one tokenizer). Evidence:

- wire probe [Exact]: 1.97 MiB mp4 → 2610 prompt tokens, video_tokens: 0 — video
  cost is duration-bounded (inter-frame deltas), NOT content-bounded;
- history images cost ~1.5-2k image tokens EACH, re-sent every turn (measured:
  11,560 image tokens in one failed request);
- vendor docs [Inferred]: GLM-5.3-Flash "native multimodal visual coding",
  multimodal corpus in PRE-training, audio-input absent — document/VLM profile
  (DeepSeek VL lineage), i.e. code rendered to frames is plausibly in-distribution;
- audio: spectrogram = picture → rides the EXISTING vision channel (Whisper-line
  practice), no audio encoder needed.

Consequence: heavy context (code, logs, audio, diagrams) can move to visual
channels at 50-150x token density, with ripgrep/CodeGraph demoted to point-sampling.
Transport prerequisite: deliver-once (Stage 0) — otherwise every modality clones.

## Stage 0 — Transport: deliver-once

See plans/2026-09-07_tool-result-deliver-once.md (C1 media once + delivered flag,
C2 token estimate excludes data: URLs, C3 canonical serializer + placeholder-by-ID).
Exit: video scenario returns 200, no cloning, no phantom compaction, cached_tokens > 0.

## Stage 1 (C5) — Video-as-context measurement

Build `tools/render_code_video` (ffmpeg + syntax highlight, 1080p, N lines/frame,
s/frame configurable).

Probes (each outputs a table into the plan's results section):
- **P1 token/second curve**: 30s / 120s / 600s clips → prompt_tokens (known point:
  ~6s ≈ 2610 tokens). Decides long-slow vs short-dense диафильм.
- **P2 density/accuracy**: lines-per-frame sweep (40/60/80/100) vs OCR accuracy on
  files with known ground truth (exact identifiers, line contents).
- **P3 temporal redundancy**: same page shown 2s in video vs single screenshot —
  static pages get multiple encoder samples (self-ensemble); measure accuracy delta.
- **P4 A/B**: same file as text vs as video — tokens, $cost, accuracy.

Smoke tests:
- renderer: input .ts → mp4 exists, frame count = ceil(lines/lines-per-frame);
- P2: accuracy ≥ 95% at the chosen density before any product integration;
- P4 table written: tokens, cost, accuracy per modality.

### Stage-1 first results (2026-09-08, experiments/c5_sweep.mts — 9/9 exact)

Renderer quirks (gyan.dev ffmpeg 2022): fontfile=<drive>\: → "Both text and
text file provided" (parser bug; use fontconfig Sans), expansion=none mandatory
(% in code). GLM-5.3-Flash: reasoning cannot be disabled (400 "Reasoning is
mandatory"); multi-question prompts loop (15k reasoning tokens → null) — ONE
short question per call (300–1300 reasoning tokens, answers exact).

- **P2 density/accuracy [Exact]**: 40/55/70/85 lines-per-frame @1440p ALL exact
  (frame-0 + deep constant, overflow.ts ground truth). Curve is FLAT in this
  range; positional question (first exported fn) missed once at 55 lpf — noise,
  not systematic. Prompt tokens do NOT depend on density: 9.6k per clip.
- **Batch диафильм [Exact]**: 3 files (~34 KB, 211+78+~200 lines) as one
  18s/9-frame video → 2/2 cross-file exact (incl. constant from the THIRD
  file), 24k prompt tokens total. RAG-shaped question over a video channel works.
- **Duration A/B [Exact — the load-bearing number]**: same content at 18s vs
  36s → IDENTICAL prompt_tokens (23,998 both). Provider cost scales with FRAME
  COUNT, not seconds. Hold-time is free (self-ensemble for OCR accuracy);
  the only density knob is frames per second, not duration.
- Token economics so far: 211-line file ≈ 9.6k tokens as video vs ~2.2k as
  text — but video caches provider-side (cached_tokens 9600 observed) and
  never re-sends under deliver-once; per-turn steady-state favors video.

Next: P1 long-clip curve (token cost of 60/120/600-frame clips = frame count ×
per-frame rate), P4 text-vs-video $ table with cache, then product integration
decision (read-tool `render` mode or a dedicated `codefilm` tool).

## Stage 2 — Audio → spectrogram channel (parallelizable, small)

read-dispatcher addition: `audio/*` → ffmpeg spectrogram PNG → existing image
attachment path (data:image/png). No SDK changes.

Smoke: read(file.mp3) attaches a spectrogram; model correctly answers "is there
speech / music / silence / tone X?" on a generated sample with known content.

## Stage 3 — Fractal layer (FIASCO/WFA)

Grounding (read-only, D:\zPython\ai_fractal\): `fiasco_rust/` (encode/decode/
image_convert/video_extract, CWFA test), `fiasco_avx2/` (fast encode),
`docs/FIASCO_WFA_Compression_Theory.md`, `angluinWFA.md`.

- **F3.1 build & verify**: cargo build fiasco_rust (cmd_runner); round-trip
  test_256.png → .wfa → decode; measure ratio + PSNR.
- **F3.2 corpus experiment** (decisive): render Stage-1 code frames → PNG vs JPEG
  vs FIASCO at matched visual quality → measure bytes, PSNR, and **vision-model
  OCR accuracy** on decoded outputs. x50-vs-JPEG claim is a hypothesis until this
  table exists (fractal coding historically weaker on sharp text/line-art).
- **F3.3 resolution-independent decode**: same compressed file decoded at 1x/2x/4x
  → OCR accuracy + token cost (tokens scale with DECODED size; bytes don't grow) —
  the unique fractal property: zoom quality "for free" at fixed storage.
- **F3.4 WFA as operator format** (bridge to Stage 4): represent a code-frame
  sequence as WFA operator stream; measure decode-ability by OUR pipeline (not the
  vendor model) — feasibility sketch only.

Honest calibration recorded in the plan: FIASCO/WFA reduce BYTES (storage, upload,
history bloat under deliver-once) and enable zoom-decode; they do NOT reduce vision
tokens (provider tokenizer bills decoded dimensions). Token economics come from the
video channel (P1) and deliver-once, not from fractal codecs.

Smoke tests: build exit 0; 3-image round-trip with PSNR report; OCR table
PNG/JPEG/FIASCO; zoom table 1x/2x/4x.

## Stage 4 (research, parked) — fractal-operator visual grammar

Custom visual grammars ("sequence of math operators" as scene representation) are
out-of-distribution for the encoder — requires a fine-tune track. Gated on Stage 1/3
data showing headroom. No product-wire work in this stage.

## Order & rollback

0 → 1 (+2 parallel) → 3 → (4 parked). Stages are independent; each lands behind its
own smoke gates; rollback = revert the stage's commits. All Stage-3 work runs against
D:\zPython\ai_fractal read-only (no mutations there from this repo's sessions).
