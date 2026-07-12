# Rotating Cube — OpenTUI Three.js WebGPU Smoke Test

Smoke test for `@opentui/three`'s WebGPU rendering pipeline.

## Terminal (WebGPU — experimental)

Requires WebGPU drivers + `bun-webgpu@0.1.7`.

```bash
cd packages/opencode && bun run experiments/20260712-rotating-cube-3d/smoke.ts
```

## Web (WebGL — reliable fallback)

Open `web.html` in any browser. Uses Three.js via CDN (WebGL, works everywhere).

```bash
# Python 3
python -m http.server 8080 -d packages/opencode/experiments/20260712-rotating-cube-3d/
# Then open http://localhost:8080/web.html

# OR just open the file directly
start packages/opencode/experiments/20260712-rotating-cube-3d/web.html
```

## Controls

| Key | Action |
|-----|--------|
| ↑↓ | Increase/decrease X rotation speed |
| ← → | Increase/decrease Y rotation speed |
| Space | Toggle scanline post-processing effect |
| Q / Esc | Exit |

The terminal test auto-exits after 30 seconds.
