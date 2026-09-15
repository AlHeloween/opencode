---
title: Anthropic OAuth — Claude Pro/Max login parity with oh-my-pi
state: COMPLETED
plan_id: 2026-09-12-anthropic-oauth-claude-pro-max
created_by: build_mode
origin: user — «хотел заимплементить oauth для антропика как в d:\zPython\oh-my-pi»; confirmed that OMP login UX is the implementation target
reproduce:
  files:
    - experiments_history/2026-09-12_anthropic-oauth/02_plugin_loader_probe.ts
    - d:/zPython/oh-my-pi/packages/ai/src/providers/claude-code-fingerprint.ts
  commands:
    - bun run experiments_history/2026-09-12_anthropic-oauth/02_plugin_loader_probe.ts
  inputs: A current, non-expired OMP Anthropic OAuth access credential; token material is read from SQLite and never printed.
  expected_outputs: The actual OpenCode OAuth loader returns HTTP 200 and the model replies `pong`; the probe refuses to refresh because its minimal test client cannot persist a rotated token.
---

# Anthropic OAuth — Claude Pro/Max

## Goal

Restore Anthropic OAuth in this fork as a first-class OpenCode auth plugin, faithfully porting the established `oh-my-pi` Claude Pro/Max flow: PKCE browser login with loopback callback and manual-code fallback, token rotation, Claude-Code-compatible OAuth request fingerprint, and visible account identity. Existing Anthropic API-key behaviour must remain unchanged.

The user explicitly replaced the earlier plan's out-of-scope decision for subscription auth. This plan supersedes only that exclusion in `2026-09-12_anthropic-cache-breakpoints.md`; cache-breakpoint work remains independent.

## Sources of truth

| Source | Status | Binding evidence |
|---|---|---|
| `d:/zPython/oh-my-pi/packages/ai/src/registry/oauth/anthropic.ts` | Inferred | Existing local implementation of authorize, PKCE, exchange, refresh, and identity resolution. |
| `d:/zPython/oh-my-pi/packages/ai/src/registry/oauth/callback-server.ts` | Inferred | Callback CSRF, loopback binding, callback HTML, timeout, and manual callback parser. |
| `d:/zPython/oh-my-pi/packages/ai/src/providers/anthropic.ts` | Inferred | OAuth-only Bearer auth, beta headers, system identity/billing blocks, CCH attestation, and 64k clamp. |
| `packages/opencode/src/plugin/codex.ts` | Inferred | OpenCode plugin hook, callback lifecycle, stored OAuth credential loader, and request-time refresh. |
| `packages/opencode/src/auth/index.ts` | Inferred | Encrypted auth-store schema and persistence surface. |
| `experiments_history/2026-09-12_anthropic-oauth/01_refresh_probe.ts` | Exact | On 2026-09-12: token refresh `200`; OAuth-fingerprinted `POST /v1/messages?beta=true` returned `200` and `pong` from `claude-sonnet-4-5-20250929`. |

## Contract

### Acceptance conditions

1. `opencode auth login anthropic` presents a **Claude Pro/Max (browser)** OAuth method; `/connect` exposes the same method instead of the current API-key-only Anthropic hint.
2. Browser flow creates a 96-byte PKCE S256 verifier/challenge and opens `https://claude.ai/oauth/authorize` with OMP's exact client ID, scopes, `code=true`, state, and a loopback `redirect_uri`.
3. The callback validates the state, shows a success/failure browser page, times out after five minutes, and uses a random loopback port if preferred port `54545` is unavailable.
4. A **Claude Pro/Max (paste code)** method accepts either a full callback URL or `code#state`; it validates state before token exchange. This is the target-platform equivalent of OMP's concurrent manual-paste fallback; OpenCode's `AuthOAuthResult` makes the two modes separate methods.
5. Exchange and refresh use the observed JSON protocol. Refresh preserves the old refresh token when the response omits a replacement and persists the rotated access/refresh pair with a five-minute expiry margin.
6. OAuth requests use Bearer auth rather than AI SDK `x-api-key`, add OAuth beta headers, use `?beta=true`, add OMP's Claude-Code identity + billing system blocks, patch CCH with `Bun.hash.xxHash64`, preserve existing cache markers, and cap `max_tokens` to `64_000`.
7. The OAuth loader does not modify API-key requests, user configuration, unrelated provider options, or existing dirty working-tree files.
8. Live request proof returns HTTP `200` through the new plugin path. Token values and credential database payloads never appear in logs, tests, plans, or commands.

### Explicitly deferred

- OMP's SQLite multi-account/org credential rotation, quota polling, remote auth broker, server-side Anthropic tools, and rate-limit rotation. OpenCode's encrypted auth store has one entry per provider and no equivalent account-routing architecture.
- Tool-name underscore translation. OpenCode's built-in tools (`bash`, `read`, `edit`, `write`, etc.) do not collide with Anthropic server tool names (`web_search`, `code_execution`, `text_editor`, `computer`). Adding request/response SSE rewriting without a collision would enlarge the blast radius. A real collision is the falsifier and requires a bounded follow-up.
- OMP's installation-derived `metadata.user_id`. The payload omission remains OpenCode's existing API-key behaviour; it is not required by the baseline live oracle.
- Importing OMP credential storage. It would move credentials between products and requires a distinct user-facing consent/UX decision. The OAuth login itself is complete without it.

## Task bindings

| ID | Paths / symbols | Change | Smoke oracle | Rollback |
|---|---|---|---|---|
| A1 | `packages/opencode/src/plugin/anthropic.ts` (new) | Port `AnthropicOAuthPlugin`: client constants, PKCE, loopback server, auto + paste auth methods, callback parser, exchange/refresh, identity extraction, and request loader. | Pure tests of authorize URL, callback/state parsing, response conversion, expiry calculation, and headers/body transformation. | Remove new plugin and registration. |
| A2 | `packages/opencode/src/auth/index.ts` | Preserve optional OAuth identity fields `email`, `orgId`, `orgName`, `authorizedAt`; no field becomes required. | Auth schema round-trips legacy and enriched records. | Revert optional fields. |
| A3 | `packages/opencode/src/plugin/index.ts` | Register only `AnthropicAuthPlugin` in `INTERNAL_PLUGINS`. | Plugin auth method list contains Anthropic OAuth. | Remove one registry entry. |
| A4 | `packages/opencode/test/plugin/anthropic-auth.test.ts` (new) | Regression coverage for all deterministic A1/A2 behaviours. Mock `fetch`; never use a real token. | `bun test test/plugin/anthropic-auth.test.ts`. | Remove test + implementation together. |
| A5 | `packages/opencode/src/cli/cmd/tui/component/dialog-provider.tsx`, `packages/web/src/content/docs/providers.mdx`, repo ledgers | Replace API-key-only Anthropic UI hint and removed-plugin statement with accurate OAuth availability; record progress and plan closure. | TUI provider-auth method discovery plus focused docs readback. | Revert scoped truth-up. |

## Protocol details copied from OMP

```text
client_id (base64): OWQxYzI1MGEtZTYxYi00NGQ5LTg4ZWQtNTk0NGQxOTYyZjVl
authorize URL:       https://claude.ai/oauth/authorize
token URL:           https://api.anthropic.com/v1/oauth/token
preferred callback:  http://localhost:54545/callback
scopes:              org:create_api_key user:profile user:inference
                     user:sessions:claude_code user:mcp_servers user:file_upload
code exchange:       JSON, grant_type=authorization_code
refresh:             JSON, grant_type=refresh_token; anthropic-beta=oauth-2025-04-20
expiry:              Date.now() + expires_in * 1000 - 300_000
absolute grant life: approximately 30 days; refresh failure `invalid_grant` requires interactive login
```

OAuth request fingerprint retained from OMP:

```text
Authorization: Bearer <access token>
anthropic-version: 2023-06-01
anthropic-dangerous-direct-browser-access: true
x-app: cli
User-Agent: claude-cli/2.1.257 (external, cli)
refresh User-Agent: anthropic-sdk-typescript/0.112.1 userOAuthProvider
endpoint: /v1/messages?beta=true
system[0]: x-anthropic-billing-header with CCH attestation
system[1]: You are Claude Code, Anthropic's official CLI for Claude.
max_tokens: min(current value, 64000)
```

## Risks

| Risk | Severity | Containment / falsifier |
|---|---:|---|
| Anthropic changes OAuth wire requirements | High | Live baseline proves the copied protocol today. Focused tests pin local transformations; live 200 is mandatory before closure. |
| Refresh token is logged or persisted incorrectly | High | No token logging; token tests use fixtures; auth storage remains encrypted/0600; credentials only flow through existing `Auth.set`. |
| OAuth changes API-key requests | High | Loader returns `{}` unless `auth.type === "oauth"`; tests cover no-op auth path. |
| SDK injects `x-api-key` alongside Bearer | High | Loader removes it from an isolated `Headers` copy before issuing the request; request-shape test asserts absent. |
| Port 54545 is busy / IPv6 localhost mismatch | Medium | Bind IPv4 plus IPv6 where available, transparently fall back to an ephemeral port; URL reflects actual port. |
| Static system blocks alter Anthropic cache keys | Medium | Expected one-time cold cache reset only for OAuth users; API-key cache configuration is untouched. |
| Subscription policy/access rejection | Medium | Never claim support without live `200`; report Anthropic's returned status/body redacted. User can re-login; no retry shims. |

## Verification sequence

1. `cd packages/opencode && bun test test/plugin/anthropic-auth.test.ts test/auth/auth.test.ts test/plugin/auth-override.test.ts`.
2. `cd packages/opencode && bun typecheck`.
3. Live loader proof: `bun run experiments_history/2026-09-12_anthropic-oauth/02_plugin_loader_probe.ts` against a current OMP OAuth credential; expect `200` and `pong`.
4. Re-run cache smoke scripts from `2026-09-12_anthropic-cache-breakpoints.md` because OAuth system blocks coexist with its Anthropic cache controls.

## No-go conditions

- Do not add token compatibility shims, aliases, silent API-key fallback, or automatic credential import.
- Do not write credentials, refresh values, cookies, browser callback URLs carrying codes, or account tokens to tracked files/log output.
- Do not alter unrelated, already dirty TUI, settings, or routing files.

## Verified outcome — 2026-09-12

OMP was refreshed to its current OAuth wire fingerprint before closure:
Claude Code `2.1.257`, SDK `0.112.1`, CLI user-agent, current system identity
block, and the updated OAuth beta profile. The local OMP repo was on commit
`72170690f9720863773c9a9255f490aa332ec762` (`Sync with upstream`).

The user re-authenticated OMP after the earlier read-only refresh rotation.
The OpenCode loader probe then returned `200` with `pong`, without refreshing
or printing any credential material. The probe now refuses to refresh an
expired OMP credential, eliminating the prior rotation hazard.
