<!-- intention: /mcps is a runtime-only toggle list -> the TUI's ONE place to attach MCP connectors: statuses, OAuth auth, add/remove with scope, persistent enable/disable, and a connector catalog (Canva first). The server-side routes (add / auth start / auth authenticate / auth callback / auth remove / connect / disconnect / status) already exist and are REUSED, not rebuilt; the work is the TUI surface, the persistence, and the connector data. -->

# MCPs connector manager — /mcps gets hands

- sv: { keywords: { mcps-ui 0.28, connector-auth 0.22, config-persist 0.18, oauth-flow 0.14, catalog-presets 0.10, kv-safe-reload 0.08 },
  dominant: "/mcps becomes the connector manager: auth, add/remove with scope, persistent toggle — built on the existing server routes (add/auth*/connect/disconnect/status), with Canva as the first catalog preset." }

## What already exists (reuse — do not rebuild)

| piece | where | state |
|---|---|---|
| server routes: status, add, auth start/authenticate/callback/remove, connect, disconnect | `src/server/routes/instance/httpapi/mcp.ts` | built ✓ (`mcp.add` = `MCP.add`, `src/mcp/index.ts:632`) |
| OAuth stack: PKCE, DCR, config clientId/secret, tokens in `bin/mcp-auth.json` (0600) | `src/mcp/oauth-provider.ts`, `src/mcp/auth.ts` | built ✓ |
| statuses incl. `needs_auth`, `needs_client_registration` | `src/mcp/index.ts:74-97` | built ✓ |
| CLI reference logic: scope (project/global), type (remote/local), JSONC config writer | `src/cli/cmd/mcp.ts` (`add` → `addMcpToConfig`) | built ✓ |
| TUI: `/mcps` list + SPACE toggle (runtime only) | `component/dialog-mcp.tsx`, `context/local.tsx:1553` | too narrow — the gap |
| TUI patterns to copy: merge-patch config write, text-entry forms | `dialog-feature-toggle.tsx` (PATCH /config, `{key:false}`/`{key:null}`), `dialog-session-rename.tsx` | reference |
| server test harness for MCP routes | `test/server/httpapi-mcp.test.ts` (status/add/connect/disconnect) | exists — extend |

## Tasks

- [x] **S1 — TUI transport for the missing calls.** No change needed: the hand-maintained SDK (`packages/sdk/js/src/v2/gen/sdk.gen.ts`) already exposes `mcp.status/add/connect/disconnect` and `mcp.auth.start/callback/authenticate/remove` — verified against the gen file and by `bun typecheck`; the TUI calls them directly. The one correction found by typecheck: `authenticate` lives on `mcp.auth`, not on `mcp`.
- [x] **S2 — Row actions in `/mcps`.** Shipped as keybinds on the list (the DialogSelect footer already teaches them, so no nested sheet): `ctrl+a` authenticate (`mcp.auth.authenticate`; the row shows ⋯ Loading until the server resolves on the browser callback), `ctrl+r` reconnect, `ctrl+l` logout (`mcp.auth.remove`); `space` keeps the runtime toggle. One `run()` writer guards overlap, refreshes via `mcp.status` and toasts the real error text; status descriptions name the acting key (`describeMcpStatus` in `component/mcp-dialog-state.ts`, pinned by `test/tui/mcp-dialog-state.test.ts`). Details and Remove remain (S5).
- [ ] **S3 — OAuth flow in the TUI.** On Authenticate: call auth/authenticate, show `⋯ waiting for browser`; subscribe `mcp.browser.open.failed` (event exists) and render the URL as selectable text when the browser did not open; refresh status via `sdk.client.mcp.status()` when done. `needs_client_registration` → sub-form for clientId/clientSecret → saved to config `mcp.<name>.oauth` (the first source `McpOAuthProvider.clientInformation()` reads), then retry.
- [x] **S4 — Add connector wizard.** SHIPPED. Steps: name (slug-validated) → type (Remote URL / Local command) → URL or argv → OAuth (auto / off / clientId+clientSecret) → scope (project `opencode.json` default, global `bin/opencode.jsonc`), persisted through the SAME writer the CLI uses — `src/mcp/config-file.ts` → then `sdk.client.instance.dispose()` (reload) + `mcp.connect`; `needs_auth` ⇒ Authenticate offered. Evidence below.
  - **Design (grounded 2026-10-08):** the CLI's `resolveConfigPath` + `addMcpToConfig` MOVE to a shared `src/mcp/config-file.ts` (both CLI and TUI import ONE writer; jsonc-parser `modify` → `Filesystem.write`, comments survive). The wizard is an async sequence on the existing primitives — `await DialogPrompt.show(dialog, …)` for text steps, `dialog.replace(() => <DialogSelect …/>)` + a promise wrapper for choice steps (precedent: `dialog-settings.tsx`, `dialog-pipeline.tsx`).
  - **Persistence + live:** write file → `sdk.client.instance.dispose()` (typed; `POST /instance/dispose`, the same reload `/config` PATCH uses) so the server re-reads config → `sdk.client.mcp.connect({name})` → refresh → `needs_auth` ⇒ offer Authenticate. Pure logic (name/URL validation, argv split, `ConfigMCP.Info` build) lives in `component/mcp-add-state.ts`, pinned by `test/tui/mcp-add-state.test.ts`.
  - **KV note:** attaching a connector changes the tool catalog → the request prefix → takes effect on the NEXT message; the closing toast says so.
- [ ] **S5 — Remove + persistent toggle.** Remove = config delete + disconnect + logout (confirm dialog, `dialog-confirm.tsx`). SPACE-toggle becomes persistent: write `enabled` into the config (merge-patch) instead of the current runtime-only connect/disconnect — the defect `dialog-feature-toggle.tsx` names in its own header comment.
- [~] **S6 — Tests, one file per cmd_runner run, from `packages/opencode`.** TUI half DONE with S2 (`test/tui/mcp-dialog-state.test.ts` 4 pass) and S4 (`test/tui/mcp-add-state.test.ts` 9 pass). (c) DONE with S4: the config write path leaves a read-back-able entry — `test/mcp/config-file.test.ts` **3 pass** (reads the written file back, comments preserved). Server half remains: extend `test/server/httpapi-mcp.test.ts` — (a) `add` returns the new status and is visible in `status`; (b) auth-start on a non-OAuth server fails loudly (UnsupportedOAuthError path).
- [ ] **S7 — Connector catalog (presets), Canva first.** A small preset table (name, url, auth kind, docs link) + "Add from catalog" entry in the wizard: pick Canva → remote `https://api.canva.com/connect/v1/mcp` → OAuth form (clientId/clientSecret from the owner's Developer-Portal app) → Authenticate. Presets live in code next to the dialog (or config), not invented at runtime.
- [ ] **S8 — Run + record.** Baseline (pre-change) → change → focused greens; live smoke: add a local echo server (`test/server/httpapi-mcp.test.ts` already uses `["echo","demo"]` as a disabled fixture) and one real OAuth connector when credentials exist; `_build.ps1` exit 0; findings into `_progress_log.md`.

## Smoke Tests

**Baseline (before any edit):** `cmd_runner start --cwd packages/opencode -- bun test test/server/httpapi-mcp.test.ts` — expected PASS (the existing 3-4 cases); any red there is STABILIZE first, per @SURFACE_PREPARATION.

**Post-change cases (predicted):**
1. `add` via TUI transport path → config file contains `mcp.<name>` (read-back) and `status` shows the server — PASS expected.
2. Toggle → `enabled` persists in the config file (read-back), a restart keeps the state — PASS expected; today it does NOT persist (expect RED on the baseline run, GREEN after S5).
3. Authenticate on a non-OAuth server → loud 4xx (`does not support OAuth`) — PASS expected (server already returns it).
4. Authenticate on a real OAuth connector (Canva, once the owner's app credentials are in config) → status flips `needs_auth` → `connected`; tokens land in `bin/mcp-auth.json` — PASS expected (live, gated on credentials).
5. `mcp.browser.open.failed` → the dialog renders the URL instead of hanging — simulated event, PASS expected.

**KV note (not a test):** attaching a connector changes the tool catalog, hence the request prefix, hence the prompt cache — the change takes effect with the NEXT message; the dialog should say so instead of pretending it is live.

## Open points (owner)

- Secrets: OAuth tokens already live in `bin/mcp-auth.json`; the Canva app's clientId/clientSecret go to config `mcp.canva.oauth` (first source read by the OAuth provider). `bin/auth.json` is the provider-key store — different file; confirm if the owner meant `mcp-auth.json`.
- Default scope for Add: project (`opencode.json`, gitignored) with global (`bin/opencode.jsonc`) selectable — mirror of CLI's choice prompt.

## Evidence (2026-10-08)

- **Baseline stabilized first** (the file was red before this plan's work): `test/server/httpapi-mcp.test.ts` → **4 pass / 0 fail** (run `20261008T101805Z_1271e094`) after commit `b4bdd4a3d5` — codegraph auto-inject opt-out + `withMcpProject` moved to the fixture's `provideTmpdirInstance` (retried cleanup for EBUSY + `Log.reopen`).
- **S2:** `bun typecheck` exit 0 (run `20261008T102036Z_7c762e8b`, re-checked `20261008T102131Z_923d8db0`); `test/tui/mcp-dialog-state.test.ts` **4 pass / 0 fail** (run `20261008T102123Z_05ee4975`).
- **S4:** the writer moved to `src/mcp/config-file.ts` (CLI imports it; `cli/cmd/mcp.ts` 798→761 lines, its now-dead `path`/`jsonc-parser`/`Filesystem` imports dropped) — artifact oracle `test/mcp/config-file.test.ts` **3 pass / 0 fail** (`20261008T121722Z_fac88f27`: comment survives the merge, entry lands, file created when absent, path resolution). Pure rules `test/tui/mcp-add-state.test.ts` RED (`20261008T121506Z_ff08e476` — module missing) → **9 pass / 0 fail** (`20261008T121519Z_e3f84a32`). `bun typecheck` exit 0 (`20261008T121606Z_b9d08b33`); regression `test/tui/mcp-dialog-state.test.ts` 4/0 (`20261008T121636Z_01454322`); `_build.ps1` exit 0 (`20261008T121644Z_5d27a34c`, smoke 10.0.1244). NOT driven live — the wizard needs an interactive TUI; that run is S8's.
