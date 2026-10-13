# The host 401 names what is missing — scheme, username, token table, permitted client

<!-- intention: a request without credentials to a worktree host answers a bare 401 "Unauthorized" that names neither the missing credential nor the permitted client, and a reader takes it for a server defect -> the 401 says what is missing and where the permitted route is, so a missing token is never mistaken for a broken server, and no secret is revealed -->

- **plan_id:** 2026-10-13_host-401-names-route
- **revision:** 1
- **state:** COMPLETE
- **reported:** owner's delegation, 2026-10-13 — the Installer admin read the DB of `D:\zPython\universal-search` while its host was live on `127.0.0.1:54625`; the bare 401 was read as «the host answers 401» (a server defect).
- **why it matters:** a reader of the bare 401 cannot tell «no credential» from «broken», and nothing points at the permitted route — `tools/opencode_host.py` (`connect(<worktree>)`) — which answers the same call correctly.

```yaml
Keywords: host-401-clarity 0.30, www-authenticate 0.22, server-host-token 0.18, permitted-client 0.16, no-secret-leak 0.14
Semantic dominant: The host's 401 for a missing or wrong credential must name the scheme, the expected username, the per-start token's table and the permitted client, and leak no secret.
md5: 7f3c9a1d2b8e4f6a9c0d1e2f3a4b5c6d
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 00000000000000000000000000000000
```

## Grounding — where this 401 is produced (measured 2026-10-13, read-only)

Two layers answer this 401; both now carry the same message.

1. **Hono `AuthMiddleware`** (`packages/opencode/src/server/middleware.ts:60-74`) — wraps every socket request on the root app (`server/server.ts:41-47`: `.onError(ErrorMiddleware).use(AuthMiddleware)` before every `.route(...)`). Measured against the owner's live host (`127.0.0.1:54625`, pid 13616, liveness confirmed by `python tools/opencode_host.py D:\zPython\universal-search` → `live`): `GET /session` with no `Authorization` header → **401, body text `Unauthorized`, `WWW-Authenticate: Basic realm="Secure Area"`**; a wrong token, a wrong username and an empty Basic pair → the same. Body/headers came from `hono` 4.12.30 `basicAuth` (default `invalidUserMessage = "Unauthorized"`, string → plain text Response). Revision fingerprint, so t7 is not reopened: the same live host answers an **authorized** `GET /session/:id/message?before=…` (no `limit`) with **400** `{"_tag":"BadRequest"}` — the single-scheme fix of `plans_completed/2026-10-08_messages-endpoint-401.md` is present in the running revision.
2. **Effect `Authorization` middleware** (`packages/opencode/src/server/routes/instance/httpapi/auth.ts:68-95`) — answers the bridged mounts (`InstanceRoutes()` mounts every Effect route via `handler(c.req.raw, context)`; `test/server/httpapi-bridge.test.ts` drives `InstanceRoutes()` directly). Its body was `{"_tag":"Unauthorized","message":"Unauthorized"}` with no header — that tagged shape is the body the admin reported; today's socket answer is layer 1's (measured above). Both layers are fixed.

`effect@4.0.0-beta.57` httpapi carries no annotation to attach response headers to a tagged error (`grep WWW-Authenticate|WithHeaders` over `dist/unstable/httpapi` → nothing), so the standard header is produced by the Hono layer (`basicAuth` sets it; kept) and the Effect layer carries the same message in its body — its clients (the in-process bridge) read the body.

## The message (one builder, both layers)

`ServerHost.unauthorizedMessage()` (`src/server/host.ts`) is the single source:

```
missing or invalid HTTP Basic credential — expected username "<username>"; the password is the per-start token recorded in this worktree's database table "server_host". Permitted client: tools/opencode_host.py — connect(<worktree>).
```

- `<username>` is read live from `Flag.OPENCODE_SERVER_USERNAME ?? "opencode"` — the username the host actually expects.
- It names the scheme (HTTP Basic), the username, that the token is **per-start** and lives in the worktree DB table **`server_host`**, and the permitted client **`tools/opencode_host.py` — `connect(<worktree>)`**.
- It carries **no value read from `server_host`** — no token, no nonce, no url, no pid, no path. The table NAME is not a value.
- Missing and wrong credentials produce the **same** message (as before, no oracle distinguishing which half failed).
- Call sites: `middleware.ts` passes `invalidUserMessage: () => ({ _tag: "Unauthorized", message: ServerHost.unauthorizedMessage() })` to `basicAuth` (object → JSON body, `WWW-Authenticate` kept, status 401); `auth.ts` throws `Unauthorized` with the same builder for username-or-password mismatch. Realm, status and the credential check (`?auth_token=`, `/global/health`, OPTIONS, no-credential pass-through) are unchanged.

## Security judgement (task item 4)

What an unauthenticated local caller learns that it did not know before: (a) Basic is the scheme; (b) the expected username; (c) a per-start token exists and its table (`server_host`) — not its value; (d) `tools/opencode_host.py` exists and how to call it (`connect(<worktree>)`).

Why this does not weaken the surface:

- Any caller who can USE this information must first read `{worktree}/.opencode/data/opencode.db` — and any process that can open the DB file can already read the token itself, read-only, exactly as `tools/opencode_host.py` does. The message moves no secret to a caller who could not already obtain it more directly.
- A caller who cannot read the tree learns no token, no nonce, no path, and cannot brute-force 32 random bytes; missing and wrong answers are byte-identical, so the message is not a credential oracle.
- A hostile web page cannot read the body: the loopback Host guard answers 403 before auth (`middleware.ts:63`) and `CorsMiddleware` grants no origin (`middleware.ts:92-107`).
- The username is the non-secret half of the pair, defaulting to `opencode` and documented in `tools/opencode_host.py:25`; the secret half stays only in the DB.
- The message keeps the literal `<worktree>` placeholder — no filesystem path goes to an unauthenticated caller.

No weakening found. Prohibition held: no draft of the message needed a value from `server_host`, a path, or the nonce.

## Acceptance — measured

| # | criterion | result | evidence |
|---|-----------|--------|----------|
| A1 | missing credential → 401 body names Basic, the username, `server_host`, `tools/opencode_host.py` | ✓ | `test/server/host-401-message.test.ts` GREEN `20261013T084916Z_9e639b7b` (socket + bridge); candidate `20261013T085717Z_94c7e362` case [a] |
| A2 | wrong credential answers the same body | ✓ | same runs, case [b] (`toEqual` missing body) |
| A3 | correct credential unchanged (200) | ✓ | same runs, case [c]; `httpapi-bridge` 8/0 `20261013T085044Z_984d37ff` |
| A4 | no `server_host` value / no path in the 401 | ✓ | new test asserts `not.toContain` token, nonce, pid, stand path — both layers |
| A5 | `WWW-Authenticate: Basic …` present | ✓ | new test asserts header; candidate case [a] printed `Basic realm="Secure Area"` |
| A6 | status stays 401 for missing and wrong | ✓ | same runs |

Literal candidate answer (`20261013T085747Z_e75c28b0`, scratch stand):

```
401
WWW-Authenticate: Basic realm="Secure Area"
{"_tag":"Unauthorized","message":"missing or invalid HTTP Basic credential — expected username \"opencode\"; the password is the per-start token recorded in this worktree's database table \"server_host\". Permitted client: tools/opencode_host.py — connect(<worktree>)."}
```

## Tasks

- [x] ✓ **T1 — test first, RED on the pre-change tree.** `test/server/host-401-message.test.ts` (socket harness `Server.listen` + `ServerHost.claim`; bridge harness `InstanceRoutes()` + `Flag.OPENCODE_SERVER_PASSWORD`). RED `20261013T084806Z_9bed60a6` — 0 pass / 3 fail, 10 expect: socket body was the old text (`JSON Parse error: Unexpected identifier "Unauthorized"`), bridge message was `"Unauthorized"` (missing every needle). (A first baseline `20261013T084628Z_1e1bad8e` also failed on a harness defect of mine — nested `afterEach` ran before the release; fixed by one file-level teardown in `host-auth.test.ts` order.)
- [x] ✓ **T2 — implement.** `ServerHost.unauthorizedMessage()` (`host.ts:111-123`); `auth.ts` — one condition, `ServerHost.unauthorizedMessage()`; `middleware.ts:73-80` — `invalidUserMessage` object on `basicAuth`. No other behaviour moved.
- [x] ✓ **T3 — pin GREEN + regressions, one file per run** (all from `packages/opencode`, cmd_runner): new file **3 pass / 0 fail** (39 expect) `20261013T084916Z_9e639b7b`; `messages-endpoint-401` **3/0** (13 expect) `20261013T084959Z_7d041531`; `httpapi-bridge` **8/0** (16 expect) `20261013T085044Z_984d37ff`; `host-auth` **3/0** (16 expect) `20261013T085133Z_bda6f7ac`.
- [x] ✓ **T4 — typecheck.** `bun typecheck` from `packages/opencode` exit 0 — `20261013T085225Z_82cdb506`.
- [x] ✓ **T5 — docs line.** `docs/organization-charter.md:103` (the sentence that routes work through the live host): «Без токена 401 — это by design; используйте `tools/opencode_host.py`.»
- [x] ✓ **T6 — dist candidate smoke.** `_build.ps1` exit 0 `20261013T085343Z_d9105bad` (90 s; smoke `--version` → **10.0.1298**; `reasoning_prompt.txt embedded`); candidate `serve` on the scratch stand `experiments/2026-10-13_host-401-names-route/stand` with 8 secret-shaped env vars stripped from the CHILD (names only: BASETEN_API_KEY DEEPSEEK_API_KEY GITHUB_PAT_TOKEN HF_TOKEN NOVITA_API_KEY OPENCODE_API_KEY OPENROUTER_API_KEY STREAMLAKE_API_KEY) — run `20261013T085657Z_b250095e`, listening `http://127.0.0.1:51809/`; `verify_dist.py` `20261013T085717Z_94c7e362` → **ALL CASES PASS** ([a] 401 names the route, no value leaks; [b] identical body for a wrong token; [c] correct token → 200; [d] `tools/opencode_host.py connect(stand).get("/session")` works). Candidate stopped.
- [x] ✓ **T7 — closure.** `svm render` names this plan in `plans/MASTER_PLAN.md` (measured: render `2026-10-13`, the plan appeared in the map); commit names the plan; plan moved to `plans_completed/`; `_progress_log.md` entry appended.

## Smoke Tests

1. ✓ **Baseline (pre-change):** RED `20261013T084806Z_9bed60a6` — old text body on the socket layer, `"Unauthorized"` message on the bridge layer.
2. ✓ **Post-change:** GREEN `20261013T084916Z_9e639b7b` + t7 trio (run ids above), one file per run.
3. ✓ **Correct credential unchanged:** 200 in both harnesses; `?auth_token=` stays pinned by `httpapi-bridge`.
4. ✓ **No-secret check:** token, nonce, pid and the stand path asserted absent from both 401 bodies.
5. ✓ **Dist candidate:** `20261013T085717Z_94c7e362` cases [a]-[d], secrets stripped from the child env.
6. ✓ **Fallibility:** case 1 IS the fallibility proof — the same file RED before the change, GREEN after.
7. ✓ Never `bun test` without a path; never the whole package suite.

## Rejected alternatives

- **Attach `WWW-Authenticate` on the Effect layer** — no annotation exists in `effect@4.0.0-beta.57` httpapi for headers on tagged errors.
- **Replace `hono/basicAuth` with a hand-rolled check** — keeps hono's timing-safe comparison for free; `invalidUserMessage` already yields an object body while keeping the header and the 401.
- **Printing the actual worktree path in the message** — the file-owning module already knows it, but the 401 goes to unauthenticated callers; `<worktree>` stays a placeholder.

## Risks (post-closure)

- **R1 — a client parsed the old text body:** checked — none in tree (`tools/opencode_host.py` acts on status; SDK has no 401 handling); the t7 files assert statuses only; all green.
- **R2 — message drifts from mechanism:** single builder feeds both layers; the test pins the four facts and the username.
- **R3 — a secret leaks into the message later:** asserted absent by the test; the builder reads only `Flag` values.

Rollback: `git revert` of the one commit — presentation only, no state, no migration.

## Tool notes (@KAIZEN, for the next cycle)

- **`cmd_runner` payload generator doubles quotes around a `.cmd` payload** (`& ''C:\…\bun.cmd'' ''test'' …` → PowerShell `BadExpression`): hit twice this session (the `bun` shim, then a `.cmd` launcher). It is the SAME class recorded in `_progress_log.md` on 2026-10-12 («cmd_runner pwsh payload double-quotes resolved bun.cmd»), i.e. its SECOND occurrence — the countermeasure is due (fix the payload quoting, or a guard). Workarounds used here: pass the **real `bun.exe` path** instead of the shim, and launch the candidate via a **python script** instead of a `.cmd`. `cmd_runner.exe` sits in the repo root and `bin/` stays untouched.
- `cua`/TUI paths were not needed: both layers are HTTP text.

## Out of scope

- Restarting or touching the owner's live TUI / anything in `bin/` (the candidate in `dist/` is verified; the owner promotes).
- Reopening `plans_completed/2026-10-08_messages-endpoint-401.md` — its class is fixed; its tests stayed green.
- Changing the realm value, the status code, or the credential check semantics.
