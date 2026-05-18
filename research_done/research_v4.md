Got it — the earlier report was too “audit-style” and not enough “what exactly is broken, where, why, and what to change.” I’ll ground this in the concrete files and turn it into a fix-oriented triage.

Thought for 21s

sv=[[codebase, opencode, concrete_issues, security, updater, database_effects, process_exit, CI_release, Vite], [0.10, 0.12, 0.16, 0.14, 0.12, 0.14, 0.10, 0.11, 0.11]]

State: the concrete problem is not “bad code everywhere.” The codebase is mostly structurally sane, but it has several high-leverage correctness/security risks where one line or one pattern changes the trust/runtime behavior. The exact priority order is: Vite dev exposure → Electron updater trust → DB effect ordering → forced process exit → release workflow/fork mismatch.

1. Vite server is open too widely

Exact file: packages/app/vite.config.ts.

The config says:

host: "0.0.0.0"
allowedHosts: true
port: 3000

That means the Vite dev server listens on all network interfaces and accepts any Host header. This is not just “developer convenience”; it can expose local dev resources to other machines on the network, and in some setups enables DNS-rebinding-style access. The file also builds sourcemaps by default with sourcemap: true, which is okay for debugging, but should be environment-gated for production/distribution builds.

Concrete fix:

server: {
  host: process.env.VITE_HOST ?? "127.0.0.1",
  allowedHosts: (process.env.VITE_ALLOWED_HOSTS ?? "localhost,127.0.0.1")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean),
  port: 3000,
}

Severity: High if developers run this on shared LAN/VPN/cloud dev boxes. Medium if always local-only.

2. Electron updater trust chain is weakened

Exact files: packages/desktop/electron-builder.config.ts and packages/desktop/src/main/updater.ts.

In the builder config, Windows update signature verification is explicitly disabled:

verifyUpdateCodeSignature: false

In the updater setup, downgrade installs are explicitly allowed:

autoUpdater.allowDowngrade = true

Taken separately, each may be explainable during early development. Together, they weaken the desktop app’s strongest protection path: “only install correctly signed newer releases.” A rollback attack or bad release-channel metadata becomes more dangerous when downgrade is allowed and update signature verification is disabled.

Concrete fix:

// electron-builder.config.ts
win: {
  ...
  verifyUpdateCodeSignature: true,
}
// updater.ts
autoUpdater.allowDowngrade = false

If downgrade is needed for emergency rollback, make it an explicit emergency flag, not the default:

autoUpdater.allowDowngrade = process.env.OPENCODE_ALLOW_DOWNGRADE === "1"

Severity: High for distributed desktop builds. This is probably the most important release-security issue.

3. Database “effects” are collected, then fired without awaiting

Exact file: packages/opencode/src/storage/db.ts.

The database context stores effects as:

effects: (() => void | Promise<void>)[]

So the type explicitly allows async effects. But after use() or transaction(), the code runs:

for (const effect of effects) effect()

It does not await them, does not catch failures, and does not preserve ordering guarantees. That means code can believe “transaction finished, side effects are done,” while in reality the effects are still running or may fail invisibly. Worse: after transaction(), this pattern can leak async work outside the intended transaction boundary.

Concrete fix option A: make effects sync-only.

const ctx = LocalContext.create<{
  tx: TxOrDb
  effects: (() => void)[]
}>("database")

Concrete fix option B: make the API async and flush effects deterministically.

async function flushEffects(effects: (() => void | Promise<void>)[]) {
  const results = await Promise.allSettled(effects.map((effect) => effect()))
  const failed = results.find((x) => x.status === "rejected")
  if (failed && failed.status === "rejected") throw failed.reason
}

Then call await flushEffects(effects) after the database operation.

Severity: High correctness risk, because it can create race conditions that are painful to reproduce.

4. CLI forcibly exits even after setting exitCode

Exact file: packages/opencode/src/index.ts.

The code has a better pattern in the catch block:

process.exitCode = 1

But then the finally block unconditionally calls:

process.exit()

The comment says this is to avoid hanging subprocesses. That is a real concern, but process.exit() is a hard stop: it can cut off pending async cleanup, pending log writes, output flushing, telemetry, DB closure, and test harness behavior.

Concrete fix: replace unconditional hard exit with bounded shutdown.

} finally {
  await shutdownChildren({ timeoutMs: 5000 })
  Database.close()
}

Then only hard-exit after timeout:

const timer = setTimeout(() => process.exit(1), 5000)
try {
  await shutdownChildren()
} finally {
  clearTimeout(timer)
}

Severity: High reliability risk for CLI/server mode; Medium for simple one-shot CLI usage.

5. Release workflow is upstream-locked and over-permissioned

Exact file: .github/workflows/publish.yml.

The workflow grants broad write permissions globally:

permissions:
  id-token: write
  contents: write
  packages: write

But most jobs only run when:

if: github.repository == 'anomalyco/opencode'

In your fork/repo, this means the discovered publish workflow mostly does not run. So there are two separate problems: it is too privileged when active, and it is not adapted to AlHeloween/opencode.

Concrete fix: split CI and release.

ci.yml should run on your repo with read-only permissions:

permissions:
  contents: read

release.yml should hold publishing permissions only on release jobs:

jobs:
  publish:
    permissions:
      contents: write
      packages: write
      id-token: write

And replace hardcoded upstream guards with your repo or configurable variables.

Severity: High operational risk, because you may think CI/release is protecting the repo when it is actually gated off.

Clean next state

I would fix in this exact order:

Lock Vite dev server to 127.0.0.1 and explicit allowed hosts.
Set Electron update signature verification to true; set downgrade to false.
Make DB effects either sync-only or awaited with failure propagation.
Replace unconditional process.exit() with graceful bounded shutdown.
Split CI from publish workflow and adapt repo guards to your fork.
After those, run full bun install, bun run typecheck, bun run lint, and package-level tests.

My judgment: the codebase is not “broken,” but it has release-grade hazards. The dangerous cluster is “desktop updater + CI release workflow + open dev server.” The correctness cluster is “DB async effects + forced process exit.” Fixing these five points gives the best risk reduction per hour.