# Plan: Migrate Provider + Gateway Layer to Rust via aisdk + WASI

**Created:** 2026-06-29  
**Status:** planning  
**Scope:** Replace TypeScript provider/gateway with Rust WASM module  

## Abstract

Compile `lazy-hq/aisdk` (Rust AI SDK, 73+ providers) to WASI preview 2, write our gateway adaptive policy + balancer in Rust on top of it, load in Bun via WASI. Eliminates all npm AI SDK packages.

## Architecture

```
TypeScript (Bun)
  config -> API keys, model IDs, provider URLs
  wasm-loader.ts -> WASI.instantiate(opencode_gateway.wasm)
  provider.ts -> thin wrapper: config -> Rust call
  REMOVED: transform.ts, balance.ts, gateway/*

        | WASI (wasi:http, wasi:cli)
        v
Rust WASM (wasm32-wasip2)
  opencode-gateway crate (NEW)
    GatewayPolicy: adaptive limiter + health scorer
    Balancer: key rotation, failover, probing
    Transform: request/response normalization
    WasiExports: generate_text, stream_text, generate_with_tools

  aisdk crate (v0.5.2, dependency)
    73+ providers, streaming SSE, tool calling, structured output
    reqwest HTTP via wasi:http
```

## Implementation — 4 phases

### Phase 1: WASI Build Pipeline

**Goal:** Prove aisdk compiles to wasm32-wasip2 and runs in Bun.

**Create:**
- `packages/wasm/gateway/Cargo.toml` — new crate with aisdk + wasi deps
- `packages/wasm/gateway/.cargo/config.toml` — target=wasm32-wasip2
- `packages/wasm/gateway/src/lib.rs` — minimal export: call DeepSeek, return text
- `packages/wasm/gateway/src/policy.rs` — stub
- `packages/wasm/gateway/src/balancer.rs` — stub

**Build:**
```
cd packages/wasm/gateway
cargo build --target wasm32-wasip2 --release
```

**TS test harness (.temp/wasi-test.ts):**
```ts
const wasm = await Bun.file(".../opencode_gateway.wasm").bytes()
const wasi = new WASI({ env: { DEEPSEEK_API_KEY } })
const instance = await WebAssembly.instantiate(
  await WebAssembly.compile(wasm),
  { wasi_snapshot_preview2: wasi.wasiImport }
)
const result = instance.exports.generate_text("What is Rust?")
```

### Phase 2: Gateway Policy Port

Port gateway/* TypeScript to Rust — same algorithm.

| TS file | Rust module | Est. lines |
|---------|-------------|------------|
| `adjustment-store.ts` | `policy.rs` | ~200 |
| `limiter.ts` | `policy.rs` | ~50 |
| `store.ts` route policies | `policy.rs` | ~100 |
| `health-window.ts` | `health.rs` | ~80 |
| `balance.ts` key rotation | `balancer.rs` | ~80 |

### Phase 3: Provider Dispatch + Transform

Wire aisdk providers through gateway. Replace `transform.ts`.

### Phase 4: Integration + Cleanup

Wire into `app-runtime.ts`. Delete `transform.ts`, `balance.ts`, `gateway/*` (15+ files).

## Test Strategy

| Phase | Test |
|-------|------|
| 1 | `bun run .temp/wasi-test.ts` — real DeepSeek call through WASM |
| 2 | `cargo test -p opencode-gateway` — policy math, limiter, key rotation |
| 3 | Integration test: streaming through gateway with real API key |
| 4 | Full build + TUI smoke test |

## Risks

| Risk | Mitigation |
|------|-----------|
| reqwest fails on wasm32-wasip2 | reqwest has `wasm` feature; verify before merge |
| WASI HTTP unstable in Bun 1.4 | Bun docs claim WASI preview 2; test gate in Phase 1 |
| aisdk version breaks | Pin `aisdk = "=0.5.2"` |
| WASM binary too large (>20MB) | `opt-level = "z"`, `lto = true`, `strip = true` |
