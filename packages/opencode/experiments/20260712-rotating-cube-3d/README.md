# Rotating Cube — OpenTUI Three.js WebGPU Smoke Test

Smoke test for `@opentui/three`'s WebGPU rendering pipeline.

## Run

```bash
bun run experiments/20260712-rotating-cube-3d/smoke.ts
```

From `packages/opencode/` — the bare `bun` runner resolves dependencies via
the package's `node_modules`.

## Controls

| Key | Action |
|-----|--------|
| ↑↓ | Increase/decrease X rotation speed |
| ← → | Increase/decrease Y rotation speed |
| Space | Toggle scanline post-processing effect |
| Q / Esc | Exit |

Automatically exits after 60 seconds.
