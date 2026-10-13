# Storage paradigm — two planes by access pattern; no ad-hoc state files (2026-09-19)

Moved verbatim from AGENTS.md (2026-10-13 split). The rule and the four binding rules stay in AGENTS.md § Storage Paradigm; this file is the record — the concurrency rationale, the scope note, the wrong turn, the accepted cost, the engine decisions with their measurements, and the migration order. *(Links inside the moved text use repo-root-relative paths, as they were written in AGENTS.md.)*

**This is a concurrency decision, not a taste one.** Every JSON file written by more than one
effect is a race with no arbiter: two writers, two read-modify-write cycles, one lost update. A
transactional store has exactly ONE writer, serialized by the engine, so the race is *absent* —
not merely unlikely. That is the property being bought, and it is why "which file does this live
in" must never again be answered by adding a file.

**Scope: ALL runtime state, not just settings.** Owner, 2026-09-19: «Я не про только agents — у нас
соплей море, вылезло — туда, ещё вылезло — опять туда.» Every "where does this live" answered by
creating a file is the growth this rule exists to stop. The measured inventory — including
`{state}/model.json`, which three modules already write — is in
[plans/to_be_confirmed/2026-09-19_fill-every-settings-layer.md](plans/to_be_confirmed/2026-09-19_fill-every-settings-layer.md) §7.

**The wrong turn, recorded so it is not repeated.** Owner, 2026-09-19: the storage split was NOT
done, and the effort went into adopting the effect runtime instead — «это принесло много
неприятностей, снижения быстродействия, крашей, и гонки эффектов.» Take that as the account of
what happened. The codebase's own signal corroborates the shape of the problem: ten floating
`slog.*` effects sit un-yielded in `session/prompt.ts` (lines 345, 368, 383, 817, 821, 828, 838,
985, 1028, 1252). The lesson is not "effects are bad" — it is that a concurrency story built on a
runtime framework, with no single arbiter underneath it, has nothing to serialize against. The
store is that arbiter; the framework is not.

**Accepted cost, on the owner's ruling.** LMDB keeps its file mapped, so on Windows `rmSync` of a
store directory throws `EBUSY` until the env is closed. Owner, 2026-09-19: «шанс на ebusy намного
ниже чем шанс на гонку effects.» Accepted and bounded: tests close the env. It is not a reason to
keep the JSON files. *(Re-confirmed live 2026-09-19, outside LMDB entirely: deleting the probe
directory failed `EBUSY` on an **empty** directory because a live process held it as its cwd — the
same Windows handle class, so treat `EBUSY` as "somebody still holds it", not as an LMDB trait.)*

### The engines — decided and measured, do not re-argue

**SQLite** (`bun:sqlite` + `drizzle-orm`) — the RELATIONAL plane, already installed: schema files
(`src/storage/schema.sql.ts`, `session.sql.ts`, `balance.sql.ts`, …), migrations
(`src/storage/migration.ts`), **92 call sites** across sessions, messages, jobs, balance, sync and
codegraph. It does not change.

**LMDB** (`lmdb@3.5.6`, MIT, Node-API) — the FAST plane, DECIDED 2026-09-19 for hot keyed state.
Measured on this host under Bun/win32-x64: `bun add` fetches its prebuild
(`download-lmdb-prebuilds11`) so no compiler is needed; three DBs live in ONE environment via
`openDB` and read back independently; **100 000 sync reads in 70.7 ms (0.71 µs/read)** straight from
mmap with no I/O; one `transaction()` spans two DBs; footprint `data.mdb` 262 144 B + `lock.mdb`
8 128 B.

**Native addon + `bun --compile` — MEASURED 2026-09-19.** This was the one open risk under the whole
migration; it is now measured, and the answer has two halves. `lmdb` resolves its `.node`
*dynamically*, and a compiled executable runs in Bun's virtual root (`B:\~BUN\root`), resolving such
a path against the **cwd** — so the addon is **not found even with `node_modules` sitting beside the
exe**. A **static ESM `import`** of the `.node`, by contrast, is visible to the bundler and is
**embedded into the executable**: proven by running that exe from an empty directory with the addon
file **physically deleted from disk** (`STATIC_IMPORT_OK`), while the dynamic build failed in the
same conditions — and corroborated independently by bytes, `87 000 064 − 86 087 168 = +912 896 B`
against `912 925 B` for `node_modules/@lmdb/lmdb-win32-x64`.
⇒ The fast plane **is** deployable, but only through a small per-platform import shim naming the
platform package literally, and `lmdb` also drags `@msgpackr-extract`'s addon (225 736 B). The shim
is **not yet written** and the real `bin/opencode.exe` has **not** been built with it — that is the
remaining step, not an assumption. Details: plan §8b.

Migration order (see the plan §7 inventory): `{state}/model.json` FIRST — it is the only entry with
three writers, so moving it retires a real lost-update race on its own.
