# Gemini OAuth protocol research — reverse-engineer Gemini CLI

plan_id: 2026-08-28-gemini-oauth-protocol-research
created_by: build_mode (user directive 2026-08-28)
state: DRAFT
revision: 1
origin: user — «Честно гемини oauth тут не работает и это отдельный вопрос на исследование, закинь в планы», «Но не сейчас», «Чтобы заставить это заработать нам придется парсить gemini cli на предмет протокола».

## Goal

Make native Gemini OAuth (Google Code Assist) work end-to-end in opencode by
reverse-engineering the Gemini CLI's OAuth protocol: client credentials,
endpoints, scopes, token-exchange and refresh flow.

## Context (grounded)

- Provider exists: `packages/opencode/src/provider/google-code-assist` (+ `src/plugin/gemini.ts`,
  which refreshes via `credentials.clientId` / `credentials.clientSecret` —
  plugin/gemini.ts:98-147).
- `auth.json` google entry shape (live, bin/auth.json): keys `type, refresh,
  access, expires, accountId` — NO client credentials inside.
- Live test `test/provider/google-code-assist-integration.test.ts` reads an
  isolated fixture (`fixtures/google-auth/auth.json`, gitignored) and skips
  without it; refresh additionally needs `GOOGLE_OAUTH_CLIENT_ID/SECRET` env.
- User's machine has native Gemini CLI OAuth at `C:\Users\Alexander\.gemini\`
  — a protocol reference candidate (its stored credentials + its bundled JS).
- **Gemini CLI source/bundle located at `D:\zPython\gemini-cli`** (user, 2026-08-28)
  — primary artifact for step 1-2 (extract client_id/scopes/endpoints from it).

## Research questions

1. R1: Which OAuth `client_id`/`client_secret` does the Gemini CLI use
   (installed-app flow ships them client-side)?
2. R2: Token endpoints + scopes required by the Code Assist API?
3. R3: Refresh semantics — rotating refresh tokens? replay constraints?
   Single-flight requirements?
4. R4: Persistence shape — map CLI tokens onto opencode's auth.json google
   entry (type/refresh/access/expires/accountId) or extend the schema?

## Steps

1. Locate the installed Gemini CLI on this machine; extract its JS bundle.
2. Grep the bundle for `client_id`, scopes, `oauth2` endpoints; document the
   full protocol (creds → authorize → exchange → refresh).
3. Diff against `src/plugin/gemini.ts` refresh flow; identify the missing
   pieces (likely just embedded client credentials + scopes).
4. Prototype refresh against the isolated fixture
   (`test/provider/fixtures/google-auth/auth.json`) — no real user home, no
   worktree-external writes.
5. Land behind the existing integration test; document the protocol in docs/.

## Acceptance

- Integration test performs live refresh + a real API call using fixture creds.
- Zero reads/writes outside the worktree (home-purity guard green).

## Smoke Tests

smoke: N/A — research plan, no product changes until findings are approved;
the existing integration test is the oracle once a fixture exists.
