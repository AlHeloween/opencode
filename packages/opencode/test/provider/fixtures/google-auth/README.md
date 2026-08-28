# google-auth fixture (isolated, gitignored)

Live-integration credentials for `../google-code-assist-integration.test.ts`.

- The test points `OPENCODE_TEST_CONFIG` here and reads `Global.Path.config/auth.json`.
- To enable the live flow, drop an `auth.json` with a `google` oauth entry:
  `{ "google": { "type": "oauth", "access": "...", "refresh": "...", "expires": <ms>, "accountId": "..." } }`
- `auth.json` is covered by the repo-wide `.gitignore` `auth.json` rule — real
  credentials can never be committed.
- Without this file the test skips gracefully.
- Token refresh additionally requires `GOOGLE_OAUTH_CLIENT_ID` /
  `GOOGLE_OAUTH_CLIENT_SECRET` env vars (the auth.json google entry does not
  carry client credentials).

Portability contract: never point this test at the real user home; credentials
for tests live only inside the worktree.
