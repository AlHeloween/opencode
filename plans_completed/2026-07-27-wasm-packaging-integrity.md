# WASM packaging integrity

## Goal

Make the compiled `opencode` executable independent of its launch directory for every application-owned WASM module, including Mermaid.

## Scope

- [x] Add an app-owned Mermaid wasm-bindgen adapter that statically imports and instantiates `mermaid_wasm_renderer_bg.wasm`; preserve its required imports and `__wbindgen_start` behavior without using the package's package-relative CommonJS loader.
- [x] Make `wasm-embedded.ts` the canonical static-import registry, and add a small JSON-emitting script so `_build.ps1` consumes the exact same logical keys and resolved source paths.
- [x] Use one sidecar layout (`dist/wasm/core/pkg/<logical-key>`) for every registry asset. This explicitly covers the active `anyrepair`, `markdownify`, and Mermaid readers; chafa is retained as a declared packaged asset and checked for readability.
- [x] Correct the stale `tree-sitter.wasm` test contract to `web-tree-sitter.wasm`; assert every registry entry is resolvable and readable.
- [x] Make the WASM health API return structured results, validate every registry asset, and instantiate/render a known Mermaid graph.
- [x] Add `opencode debug wasm`; the compiled `D:\zPython\opencode\dist\bin\opencode.exe` passes it from `D:\zPython\codex` with 72 checks, Mermaid=true, and zero asset failures.

## Non-goals

- Do not change session prompts, message conversion, or any KV-cache-sensitive code.
- Do not package all 95 transitive `node_modules` WASM files; include only application-reachable assets.

## Smoke Tests

### Baseline [Exact]

Run from `packages/opencode`:

```powershell
bun test --timeout 30000 test/util/wasm-embedded.test.ts test/util/mermaid.test.ts
```

Actual: Mermaid rendering is `11 pass, 0 fail`; embedded-WASM coverage is `18 pass, 2 fail`. Both failures request the obsolete `tree-sitter.wasm` key, while the registry exposes `web-tree-sitter.wasm`.

### Post-implementation

1. The focused suite passes with every manifest asset readable and Mermaid rendering a known graph to SVG.
2. `opencode debug wasm` prints structured success and exits 0 only when every registry entry and the Mermaid render pass.
3. `bun typecheck` exits 0 from `packages/opencode`.
4. A freshly compiled executable passes `debug wasm` when launched from an external project directory with no checkout `node_modules` dependency.
5. `git diff --check` exits 0.

## Actual [Exact]

- `bun test --timeout 30000 test/util/wasm-embedded.test.ts test/util/mermaid.test.ts`: 16 pass, 0 fail.
- `bun typecheck`: exit 0.
- `pwsh -File _build.ps1 -SkipOpenTui`: exit 0; copied 66 registry-driven WASM sidecars.
- From `D:\zPython\codex`: `D:\zPython\opencode\dist\bin\opencode.exe debug wasm` returned `ok=true`, 72 checks, Mermaid=true, and zero failures.
- `git diff --check`: exit 0.

## Prior art

N/A — the repository already owns `wasm-embedded.ts`, `wasm-path.ts`, and `wasm-health.ts`; the change consolidates those existing mechanisms.
