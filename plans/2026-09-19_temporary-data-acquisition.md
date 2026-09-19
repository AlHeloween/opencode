# Temporary data acquisition — images, documents and sources held in one active set

<!-- intention: an acquired item stays in the attended window for ever, has no lifetime, and cannot be released -> acquired content (frames, documents, sources) is held in one active set for a declared span, released to an addressable pointer, and the release carries the recorded diffs as its report -->

Owner ruling, 2026-09-19 (verbatim): «Идея с links для изображений провалилась. Короче надо в
контент кидать webp, без вариантов. Но тут мы вот что сделаем! Мы делаем контент — и добавим тул —
актуализатор/деактуализатор — что это значит что если ты решил работать с скриншотом то ты тулзой
даешь — дай мне, 1,2,3 скриншоты и они будут всегда добавляться в хвост. Кешировать не надо. Линки
у тебя в списке есть, но ты их не видишь, ловишь идею?»

This SUPERSEDES `plans/2026-09-18_attachment-image-store.md` (content-addressed store + messages
carrying references + derived-copy fallback). That plan is dead — see §5.

## 0. Implementation plan (2026-09-19) — one gateway transform, behind a flag, proven in a sandbox

Owner, 2026-09-19 (verbatim):

> «Назовем temporary data aquisition, впихнем в gateway, больше некуда, картинки только часть, тсчательно
> спланируй, потом сделай и проведи тесты, на сколько точно на сколько это вообще возможно, потом собери
> отдельно и запусти в песочнице, будем смотреть логи и чего делает, через jsonc задай ему модель
> big-pickle чтобы не напалить токены на тестах, пока не убедимся что все палит - лучше это не копировать
> в workflow. Это серьезный пайплайн. И требует не менее серьезного подхода.»

### 0.0 What this is NOT: it is not RAG (owner, 2026-09-19)

Owner, verbatim:

> «есть исходник - 1мб - его надо поправить что мы делаем начинаем грепом его лазить забиваем окно,
> делаем исправления которые скорее всего будут лажей и трахаемся с ним до посинения, тут мы целяем его
> в хвост, точто правим по месту или делаем рефактор как обычно без ошибок без грепов, он же у нас в
> памяти висит, исправлили и отпускаем - окно чистое - только резульатат и отчет… это даже не раг это
> другое, это временные данные которые мы делаем частью агентного потока только временно.»

The distinction is not framing, it decides the design:

| | RAG | TDA |
|---|---|---|
| the unit | a FRAGMENT retrieved on demand | the WHOLE artifact, acquired once |
| the cost | a round trip per fragment, each one partial | one hold, then nothing |
| the edit | made against fragments — which is WHY edits come out as «лажа» | made against the whole artifact, attended |
| the end | fragments keep accumulating | RELEASE: window clean, result and report |

**The sharpest form of the distinction (owner, 2026-09-19): «Да - это не поиск - поиск оставляет следы,
это TDA и точка.»** A grep, a read, a fetch — each one DEPOSITS a fragment in the transcript and it stays
there. Acquisition ends in a RELEASE, so the artifact leaves no residue. The difference is not the
retrieval, it is what is left behind.

⇒ «grep the file, fill the window, edit blind» is the failure mode this replaces. The agent does not
SEARCH the artifact; it **holds** it, so an edit is made with the whole thing in front of it.

**The acceptance story, in one line:** a ~1 MB source is acquired, edited or refactored with NO greps,
then released, and what remains in the window is the result and the report. Its measurable half: fewer
turns than the equivalent grep loop, and a compaction that did NOT happen.

### 0.1 The division of labour — checked against the code, not assumed

«Впихнем в gateway» is right, and the seam already exists:

```
provider/gateway/adaptive-client.ts:332   export function wrapFetch(_baseFetch)        ← installed by mod.ts:79
provider/gateway/adaptive-client.ts:347   init = { ...init, body: rewriteReasoningContent(init.body) }
```

`rewriteReasoningContent` is the PRECEDENT: a pure `body → body` function applied inside `wrapFetch`,
collapsing a duplication the runtime cannot see. It fetches nothing, stores nothing.

The gateway sees the TRUE outgoing body, and that decides the split:

| half | owner | why |
|---|---|---|
| **acquire / re-attach** | the RUNTIME | the only thing holding the parts and the DB; new content enters as a tool attachment, which already works (`tool/tool.ts:32`) |
| **hold** | the SET | a keyed record, not a computation |
| **release / withhold** | the GATEWAY | only the gateway sees the real body — and withholding needs no payload source, because the payload is already IN the body |
| **re-acquire** | `recall` (results) / the runtime (attachments) | shipped for tool results; the attachment leg is T2 |

**Rejected: payloads in a gateway store.** Re-attaching from the gateway would make the gateway hold
image bytes — the store the earlier plan explicitly refused («no caching») — and it would duplicate
ownership of the same bytes. The gateway WITHHOLDS; it does not supply.

### 0.2 The transform, as one pure function

```ts
// provider/gateway/tda.ts
export type TdaHeld = {
  id: string
  kind: "image" | "document" | "source"
  reason: string
  expiresAtTurn: number
  digest: string      // ← ADDED by T1. Matching is content-addressed; see below.
  reader?: string     // ← ADDED by T1. Declared by the runtime, never invented by the gateway.
}
export type TdaSet = { held: TdaHeld[] }
export function applyTemporaryDataAcquisition(body: string, set: TdaSet, turn: number): string
export function payloadDigest(url: string): string   // ONE implementation, shared with the acquirer
```

### 0.2.1 Matching is CONTENT-ADDRESSED — decided by T1, and the plan's type did not have it

An `image_url` entry is `{type, image_url: {url}}`: **the body carries no part id**. So the only thing
that can tie a body payload to a set item is the payload itself, and `digest` is therefore a FIELD of
the held item, computed by the runtime at acquire time with the SAME exported function the gateway
matches with. Two implementations of "which payload is this" would drift invisibly and the drift would
surface as an item that can never be released.

The alternative — matching the `[Image N]` ordinal the transcript prints beside the image — was
rejected because it couples this layer to the numbering decision (§4.1, still open) and breaks for any
item acquired without a transcript label (a CUA frame, a fetched document, a stored source).

`reader` exists for the same reason `reason` does: the pointer must not name a reader it cannot
promise. It is declared by the runtime (which knows what is registered), and when it is absent the
pointer SAYS the runtime holds it rather than naming a tool that cannot return the item — the exact
lie the dropped-result placeholder shipped once ("re-read or re-run the tool" is impossible for a
`task` result and unsafe for `bash`).

1. **Withhold a released or expired item** — its payload in `messages[]` is replaced by the one-line
   pointer, using the SAME grammar the tool placeholder already prints (`REPLAY_DELIVERED_MARKER`,
   imported rather than copied). Pure function of `(kind, id, reason, reader, size)`, so the
   replacement is byte-stable.
2. **Keep a held item** — untouched.
3. **Never blank.** A replaced payload must leave a pointer; if a pointer cannot be built (no id), the
   payload is left alone. This is the invariant the `keep` defect bought.
4. **Do nothing when the set is empty**, and return the input UNCHANGED when the body does not parse. A
   transform that corrupts a request is worse than one that does nothing.

### 0.3 Where the set lives — ANSWERED (T0, 2026-09-19), and the draft was wrong

Grounded, and it changes the answer:

```
provider/gateway/store.ts:24   const STORE_FILE = "gateway-adjustments.json"
provider/gateway/store.ts:26   const PERSIST_INTERVAL_MS = 30000
provider/gateway/store.ts:37   path.join(Global.Path.data, "gateway")      ← its own dir, plus a policy log
```

The gateway's `Store` is an ad-hoc JSON file flushed every 30 s. Putting the TDA set there would GROW an
ad-hoc state file, which `AGENTS.md`'s storage paradigm forbids by name («Every new piece of state goes to
one of them [SQLite / LMDB] under a declared namespace — never to a new file»), and it would give the set
TWO writers — the race that paradigm exists to prevent.

**Decision: the RUNTIME owns the set on the SQLite plane, and the gateway receives it in a header.**
`x-opencode-tda`, read beside `x-opencode-has-attachments` at `adaptive-client.ts:410-414`.

**Corrected at T3a — the mechanism is HALF-there, and the header has a REACH.** Measured:
`x-opencode-has-attachments` occurs exactly ONCE in `packages/opencode/src` and it is the READER; no
writer exists, so the classifier's `hasAttachments` is permanently false (the same "N reads, zero
writers" class the modality gate had). The send site is `session/llm.ts:977-981`, and its three-layer
contract (2026-09-08, stated in-file) is explicit: `x-opencode-*` are sent **exclusively to opencode-owned
providers** (`providerID.startsWith("opencode")`) because «third-party providers react badly to foreign
namespaced headers». ⇒ TDA is INERT on third-party routes (deepseek-direct, novita, openrouter): the
instruction cannot be sent there, so the gateway can never withhold. That is not a defect to route around —
it is where the mechanism legitimately reaches today — and it makes the sandbox's `opencode/big-pickle`
choice load-bearing for the OBSERVATION, not only for the cost.

```
transform = pure(body, setFromHeader)   →  one owner: the runtime
no gateway persistence                  →  the paradigm holds
no second writer                        →  the race is absent, not unlikely
```

The earlier objection to a header was about an UNBOUNDED set. With a cap (a few dozen bytes per held
item) the header stays small — so the cap stops being a nicety and becomes load-bearing, and it is T3's
decision.

### 0.3.1 The payload's shape on the wire — read from a real capture, not from code

`.opencode/data/gateway/raw-wire/<ts>-<id>.json` holds the bodies the gateway actually SENT. A media part
there is exactly:

```json
{ "role": "user",
  "content": [
    { "type": "text", "text": "[Image 1] …" },
    { "type": "image_url", "image_url": { "url": "data:image/webp;base64,…" } },
    { "type": "text", "text": "Called the Read tool with the following input: {…}" }
  ] }
```

⇒ the transform's target is exact: **a `content[]` entry of `type: "image_url"` whose `image_url.url`
starts with `data:`**. That entry is what a release replaces with the pointer.

Grounding the fixture from a CAPTURED body rather than a hand-written one is what T1's oracle depends on —
the same lesson the `recall` fixture taught: a fixture shaped by the author cannot observe the author's
mistake. The captures are on disk, so the fixture is reproducible rather than invented.

Side finding: the wire ALREADY carries an ordinal beside the image (`[Image 1]`), which is the inventory
§4.1 requires — so that half of the numbering exists today and only the release half is missing.

### 0.4 Behind a FLAG, default OFF

`gateway.tda.enabled: false`. The sandbox config turns it on; the workflow config does not until the
sandbox is green. That is «лучше это не копировать в workflow» expressed as a DEFAULT rather than as
discipline — a flag cannot be forgotten, a resolution can.

The whole surface, declared in `.opencode/gateway.jsonc` beside the existing gateway settings, so every
limit in §0.9 is a number in a file rather than a constant in a function:

```
gateway.tda.enabled        false   the master switch
gateway.tda.maxItemBytes   §0.9-1  the cap that stops «захватить 1 гигабайт»
gateway.tda.maxHeldTokens  §0.9-2  held total against usable()
gateway.tda.priceMargin    §0.9-2  the reserve for an inexactly-priced item
gateway.tda.maxItems       §0.9-3  keeps the header transport valid
gateway.tda.holdTurns      §10     the declared lifetime
```

**Refined at T2 — it removes a surface.** The GATEWAY needs no flag: it withholds only when the runtime
hands it a set, so the ABSENCE of `x-opencode-tda` already is "off". These keys therefore belong to the
RUNTIME's config, read where the set is built, and T4 becomes "the runtime reads the flag and sends the
header" rather than "the gateway reads config". One authority for the switch instead of two, and the
zero-cost short-circuit stays true whenever nothing is held.

### 0.5 Tasks

| id | task | binding | oracle |
|---|---|---|---|
| **T0** | ground `Store` and the exact body shape a media part takes | the Store module, `adaptive-client.ts`, a raw-wire capture | **DONE — §0.3 + §0.3.1** |
| **T1** | the pure transform | new `provider/gateway/tda.ts` | **DONE — 2026-09-19.** withhold · keep · blank-guard · no-op on an unparsable body · untouched body returned as the SAME STRING (T2's flag-off control) · payload-digest stability across mime wrappers. Oracle: `bun typecheck` exit 0 · `test/provider/gateway-tda.test.ts` **8 pass / 0 fail / 25 expect**. Fixture provenance MEASURED, not assumed — §0.3.1 |
| **T2** | wire it into `wrapFetch` beside `rewriteReasoningContent` | `adaptive-client.ts` — with the other consumed `x-opencode-*` headers | **DONE — 2026-09-19.** The set arrives in `x-opencode-tda` and is CONSUMED, not forwarded (it has been folded into the body). Integration oracle `test/provider/gateway-tda-wire.test.ts` **5 pass / 0 fail / 17 expect**: withheld on the wire with the pointer in place and its neighbours untouched · byte-identical with no header · a held item untouched · a body carrying a different payload untouched · five malformed headers degrade to nothing · the instruction is not forwarded, with a forwarded header as control. `test/provider/adaptive-client.test.ts` 4/0/35 unchanged. |
| **T3a** | the set's RULES — acquire, hold, release, expire — as PURE functions | new `session/acquired-item.ts`; `isWithheld` imported from the contract module | **DONE — 2026-09-19.** held survives every turn of its span and is withheld after it · a release withholds AT ONCE and does NOT rewrite the span (two facts, not one) · releasing another id changes nothing · the instruction round-trips through `parseTdaHeader` and withholds the very payload it describes · an empty set says nothing. Oracle: `bun typecheck` exit 0 · `test/session/acquired-item.test.ts` **5 pass / 0 fail / 23 expect** · gateway suites 9/0/26 and 5/0/17. |
| **T3b** | PERSISTENCE: the `acquired_item` table (DDL + drizzle) and the store — reads/writes plus the turn counter | `storage/db.ts`, `storage/schema-project.sql.ts`, new `session/acquired-item-store.ts` | **DONE — 2026-09-19.** the two descriptions of the table are reconciled by reading the ARTIFACT back (`PRAGMA table_info`, 10 columns) · held → withheld when the span passes · released → withheld at once with the span untouched · re-acquiring one payload refreshes instead of duplicating. Oracle: `bun typecheck` exit 0 · `test/session/acquired-item-store.test.ts` **3 pass / 0 fail / 13 expect** |
| **T3c** | the SEND SITE: the header in `llm.ts`, inside the `providerID.startsWith("opencode")` block — created, not joined, since `x-opencode-has-attachments` has no writer | `session/llm.ts` + the pure `tdaHeaders` decision in `session/acquired-item.ts` | **DONE (pure half) — 2026-09-19.** `tdaHeaders` returns `{}` for no value and for every third-party provider, and the header for `opencode`/`opencode-go` — both boundaries pinned at `test/session/acquired-item.test.ts`, 5/0/23 → see the suite. **Residual: the wiring LINE is observed on the wire, not in a unit test — T5's sandbox is its oracle.** The store is read on that branch only, so a session that never acquired sends nothing |
| **T3d** | the FOLD TRIGGER: a bulk release at the fold boundary, decided in the SAME seam as the fold | `session/acquired-item-store.ts` (`releaseAll`) + `session/prompt.ts` (one `const foldChoice` computed before the switch) | **DONE — 2026-09-19.** every item of the session is released when `foldDecision` answers anything but `defer` — the trigger is the FOLD, not the clock — and it is a release, not an erasure: the spans are untouched and the items remain, which is what lets the model re-acquire them by the id the pointer prints. Oracle: `bun typecheck` exit 0 · `test/session/acquired-item-store.test.ts` **4 pass / 0 fail / 17 expect**. Residual: the hook LINE itself is observed on the wire (T5), the same residual T3c carries |
| **T4** | the flag | `config/config.ts` gateway section + `gateway.jsonc` | **DONE — 2026-09-19.** `gateway.tda` declared beside `gateway.logDir`: `enabled` (default off), `holdTurns`, `maxItems`, `maxItemBytes`, `maxHeldTokens`, `priceMargin` — every §0.9 limit a number in a file. The pure `tdaHeaders(providerID, value, enabled)` carries BOTH gates (the switch and the header contract) so neither can be forgotten at a call site. Oracle: `bun typecheck` exit 0 · the three gates pinned in `test/session/acquired-item.test.ts` (switch off ⇒ nothing, even for `opencode`; third party ⇒ nothing, even with the switch on; nothing acquired ⇒ nothing). **Enforcement of the four limits lands with the ACQUIRER** — declaring a limit before there is anything to refuse is honest; enforcing it where nothing can be acquired yet would be a guard with no subject |
| **T5** | the sandbox run | the double lives at `experiments/2026-09-19_tda-sandbox/` (`mock-zen.mjs` + `gateway.jsonc` provider `opencode-sandbox`); the OBSERVATION runs as `observe-real-body.ts` | **OBSERVATION OBTAINED — 2026-09-19, though not through the sandbox.** The transform was driven over a REAL captured body (938 424 chars) carrying a real 143-char WebP payload: the `image_url` block was replaced by the pointer, delta +44, **everything else byte-identical**, control (unmatched digest) untouching — §0.6-4 on real bytes. **Finding:** the payload rides in 6 forms; only the structured `content[]` entry is rewritten, five survive inside strings (`messages[101] tool`, `[102] assistant` ×2, `[113] tool`, `[115] tool`), so a release leaves the bytes on the wire as text. **Sandbox residual:** no request reaches the local double and the error is identical to Zen's, i.e. upstream-independent; the untested discriminator is a CLOSED port (connection error ⇒ the URL is consulted; same message ⇒ no fetch at all) |
| **T6** | the TTL FIELD — the owner's final form: a `ttl` on the part itself, TWO tools, ALL spammy tools | `ttl` on the part schema (`FilePart` / tool state, so it rides the part's own `data` — no new table, no migration) · `TempEnable` / `TempDisable` returning id + report + ids_range · the conversion gate reading the PART's own ttl against ONE number (the current turn) · summary exclusion · fold auto-reset | **DESIGNED — 2026-09-19.** Owner, verbatim: «не только для read, а для всех тулов которые спамят… TempEnable и TempDisable(…report…) return id+report+ids_range; ttl=null (permanent)… поле в базе ttl=[null - permanent, tmp_xxx session, число - ttl turns); в summary не считается; доползли до компакта — ок, сбрасываем автоматом, оставляем сообщение». Off by default. **This SUPERSEDES the table shipped in `74f0ab0d8a`** — `held_media`, `session/held-media.ts`, its test and the `expiredMedia: Map` option are DELETED (zero consumers, so the removal costs nothing), and the conversion needs one number instead of a map, which also removes the DB query that broke 42 cases. |

### What THIS plan covers now — and what it no longer does (owner, 2026-09-19: «а то мы наш tda никогда не доделаем»)

**Covers, and this is the whole of it:** `ttl` on the part (`null` = permanent ⇒ the mechanism does not
apply at all | `"tmp_xxx"` = scoped to a temporary enable | a number = turns), `TempEnable` / `TempDisable`
returning id + report + ids_range, the ONE conversion gate reading the part's own ttl against the current
turn, the summary exclusion, the fold auto-reset, and the tests for each.

Its domain is the **sub-threshold spam** — hundreds of small tool results that today live in the window
forever, because neither the 8 000-char placeholder nor a fold ever touches them. That is why the owner
said «все тулы которые спамят» and not «тяжёлые тулы»: where the payload is heavy, the size rule already
fires first and the ttl adds nothing.

**No longer covers, kept rather than deleted:** the gateway transform, the `x-opencode-*` header, the
`expected` / verdict / note design, and the `releaseAll` fold hook. All committed, green and tested; they
retire when nothing calls them («мы ничего выкорчевывать не будем»). The `held_media` TABLE goes: zero
consumers, and a table was the wrong shape from the start.

**Moved out to `plans/2026-09-19_database-truth.md`:** the dead turn source (`session_entry`, 0 rows), the
table inventory, and the fixture rule — a property of the storage plane, not of TDA.

### T6 design, and the three things it deliberately does NOT do

> **SUPERSEDED WITHIN THE HOUR — recorded rather than deleted, because the reason it was wrong is the useful part.**
> Owner, 2026-09-19: «мы стрипаем мультимедиа сообщения сейчас… не хватает просто маленькой таблички message id
> и ttl… ничего городить не надо». The design below moves the release ONTO THE WIRE (a digest, an expectation in
> the header, a verdict, a note). If the runtime already removes a payload at CONVERSION — which it does for a heavy
> tool result — then nothing needs to reach the wire at all, and every piece below becomes machinery built to
> solve a problem that a table of `(id, ttl)` and one branch at the existing decision point solves outright.
> Cost compared, and it is the SAME: both remove bytes from the middle of the body at the moment of expiry, so the
> prefix changes once in either case — the «частичная потеря кэша» the owner accepted when choosing the chain
> placement. Effect compared: identical, because the strip is at conversion, so HISTORY stays intact and only the
> request changes. Kept, not deleted: the gateway leg is committed, green and tested, and the transition is
> problem-driven and gradual («мы ничего выкорчевывать не будем») — it retires when nothing uses it.

1. **The runtime states the EXPECTATION; the gateway reports the OUTCOME.** `expect: string[]` rides the same header, holding the ids whose payload this request should find on the wire. It is computed where the model IS known (`llm.ts` has `input.model`): released ∧ the model accepts the item's kind ∧ `attachment`. Nothing else is needed — and that matters, because:
2. **The window is NOT checked.** A part still being inside the sent window is not cheaply knowable at the send site (`input.messages` are provider-shaped, no part ids), so the note instead behaves like the fold nag: it repeats until the situation is resolved. Bounded by the item's span, and it retires itself the moment the payload is re-acquired.
3. **The gateway stays stateless and the body stays the only surface.** No callbacks, no response headers, no new state: the note is written into the body the transform is already rewriting, at the END, so the prefix — and therefore the KV cache — is untouched.

Kind→modality is deliberately INCOMPLETE: `image` maps to `capabilities.input.image && attachment`; `document` and `source` map to nothing yet, so they stay SILENT. An incomplete map can lose a note; an invented one would raise a false alarm, and a false alarm sends the agent re-acquiring what never rode.

### Smoke Tests

- **baseline (before any edit):** `bun typecheck` exit 0 · `gateway-tda` 9/0 · `acquired-item` 6/0 · `acquired-item-store` 4/0 · `gateway-tda-wire` 5/0.
- **branch 1 — expected ∧ found:** the payload is replaced by the pointer, and NO note is added (`asked 1, withheld 1`).
- **branch 2 — expected ∧ NOT found:** the body gains exactly ONE trailing message, naming the item id, kind and reason; the original body is still a byte-exact PREFIX of the result (prefix ⇒ cache held).
- **branch 3 — NOT expected (blind model, or a kind with no wire form):** silence. **This is the false-alarm control**: with `expect: []` the output is byte-identical to the input.
- **branch 4 — held, not released:** untouched, whatever the expectation says.
- **the count is reported, not inferred:** `asked` counts the RELEASED items only; a held item in the same set never inflates it.
- **post-change:** the same suites green, plus the capture harness (`observe-real-body.ts`) still replacing the real payload in the real 938 KB body.
| **T6** | the release report | — | the report names files the snapshot shows changed (`git status`), not recalled |
| **T7** | acquire a STORED RECORD — a `project_checkpoint` row, a message range — by id | the SQLite plane + the runtime's set | priced by `data.tokens` for an assistant message, by measure otherwise; **refused** when it would cross `usable()`; released to a pointer like any other item |
| **T8** | epoch-addressable memory — pull a specific earlier summary, hold it for the span, release it | T7 + §0.8 | the summary is in the request while held and absent after the release, and the same one is re-acquirable by id |

### 0.6 The sandbox protocol — the owner's requirement, made checkable

1. `pwsh _build.ps1 -Task build` into a SEPARATE artifact; do **not** deploy to `bin/`.
2. The sandbox config sets `"model": "opencode/qwen3.6-plus-free"` (owner ruling, 2026-09-19), NOT
   `opencode/big-pickle`, which is TEXT-ONLY — verified against the catalog: `big-pickle` is absent from
   the 88 vision-capable models the `opencode` provider hosts (measured with
   `.opencode/opencode-models-probe.mjs`: 107 models on `opencode`, 88 with image input, SEVEN of them
   at cost 0/0). The ROUTE matters as much as the eyes: `x-opencode-*` reach only
   `providerID.startsWith("opencode")` (§0.3), so a free vision model on OpenRouter — `inkling:free` was
   the first suggestion — would leave the gateway with no set to act on and the sandbox observing a
   clean no-op, i.e. «works» read out of silence. `qwen3.6-plus-free` satisfies all three at once:
   vision (`text+image+video`, `attachment: true`), cost 0/0, and a route the instruction actually
   travels. Catalog caveat: `minimax-m3-free` declares image input with `attachment: false` — "sees
   images" is not enough, the item must be an ATTACHMENT.
3. `gateway.jsonc` already logs `logBodies: true` + `perRequest: true`: every request is a file under the
   per-request directory. **The sandbox is observed there, not by reading the TUI.**
4. Whole-sandbox falsifier: a flag-ON body differs from the flag-OFF body in NOTHING except the withheld
   payloads.
5. **The run must carry an image.** No capture in `raw-wire/` carries a media entry — and the reason is
   the CONVERTER, not age: `@ai-sdk/deepseek@3.0.26` was text-only, so every non-text part went to
   `warnings` and was never serialized («183 raw-wire bodies scanned: zero image parts»,
   `_progress_log.md`), fixed by the 3.0.48 bump. The sandbox must therefore attach or acquire an image
   INSIDE the run, or the surface it is observed on has nothing to show. *(First attributed to age from
   two timestamps — the record refuted it. A plausible cause stated before the record is queried is the
   reflex this project's memory already names; keeping the correction here costs one line and stops the
   next cycle from re-deriving it.)*

### 0.7 Risks, each with its falsifier

- **Byte-stability.** Withholding changes that session's prefix on the first turn after a release. That
  is the feature — but it must happen ONCE. Falsifier: two consecutive requests with the same set are
  byte-identical.
- **An O(body) scan on the hot path**, for every request of a wrapped provider. `rewriteReasoningContent`
  is already O(body), so the shape is allowed — but the cost must be MEASURED, not assumed.
  **Shape measured at T1:** the transform short-circuits on an empty set and on a set whose items all
  still hold, so the flag-OFF cost is exactly ZERO (the input string is returned, not re-serialised);
  with something actually released it is one `JSON.parse` + `JSON.stringify` — the shape the reasoning
  rewrite already pays — plus one sha256 per `data:` payload. The NUMBER belongs to T2 on the real hot
  path; a synthetic body would measure the fixture, not the path.
- **Two writers to one session's set** (runtime and gateway) is exactly the race the storage paradigm
  exists to prevent. T0 names ONE owner; if both write, the set is broken by construction.

### 0.8 Acquiring from the DATABASE — memory modules from another epoch (owner, 2026-09-19)

Owner, verbatim:

> «надо бы его расширить до сообщений из базы тогда ты сможешь временно подключать модули памяти из
> разных эпох работы, какой нибудь summary или просто память состояния. Разумеется в разумных пределах
> чтобы не вылезти за пределы окна контента. Токены считать ... в принципе в базе есть значения, так
> что все должно быть окей.»

This makes the acquire unit a **stored record**, not a payload: a `project_checkpoint` row (a summary), a
message range, a block of state memory. The mechanism is unchanged — acquire, hold, release — but the set
addresses RECORDS rather than only frames. The set therefore holds **references (ids)**, not bodies, which
is a second reason the header transport of §0.3 is right: the runtime resolves a reference against the DB
at request-assembly time, so nothing large ever rides a header.

**The price, checked in the database rather than assumed — and the premise is HALF true:**

```
message, role=assistant    2604 rows, 2604 carry `tokens`    → price is a LOOKUP
message, role=user          269 rows,    0 carry `tokens`    → price must be MEASURED
project_checkpoint           24 rows, NO token column at all → price must be MEASURED
             307 016 chars of `body` + 330 543 chars of `diffs`+`impact`+`plan_state`; 22 materialized
```

So: an assistant message is priced by reading `data.tokens` — billed by the provider, exact. A user message
and a checkpoint carry no token count at all, and their price is the same measure the window budget already
uses for growth (`token-count.ts`, whose `chars/4` fallback reports itself inexact). **Do not write "the DB
has the values" as if it covered all three** — it covers exactly one of them.

**The bound is the WINDOW, not a count.** «в разумных пределах чтобы не вылезти за пределы окна» is
`usable()`: an acquisition is refused when held + acquired would cross the fold threshold. A count cap
cannot express this — two checkpoints from different epochs differ by an order of magnitude (the 24 here
average ~26 600 chars, while a single `diffs` block has been measured at 96 797).

**Why this is worth doing at all:** a fold is one-way today. Content is summarised, the summary is
materialised into `m*`, and nothing can pull a SPECIFIC earlier epoch back for a bounded time. Acquisition
makes memory addressable in BOTH directions — and the release is what guarantees the window returns to
clean instead of slowly filling with everything anyone ever looked at.

### 0.9 The bound: a margin and three caps (owner, 2026-09-19)

Owner, verbatim:

> «Расчетчик токенов есть, сделаем запас… Конечно надо бы туда добавить ограничивающие приблуды чтобы
> не захватить 1 гигабайт)))»

Four limits, and each catches a different mistake — none of them is redundant:

1. **Per-item BYTE cap.** One acquisition above the cap is refused outright; a large text may instead be
   acquired TRUNCATED with a pointer, the same grammar as every other release. This is the one that stops
   «захватить 1 гигабайт».
2. **Held-total TOKEN cap against `usable()`**, with the MARGIN the owner asked for:
   `Σ held + acquired × (1 + TDA_PRICE_MARGIN) + reserve ≤ usable()`. The margin exists for a measured
   reason: the price is EXACT only for an assistant message (`data.tokens`); a checkpoint and a user
   message go through the counter's inexact fallback, which reports itself inexact (§0.8). A constant, not
   a feeling — and it is the reason a marginal acquisition is refused rather than attempted.
3. **Item COUNT cap.** The set travels in the header, so the set's size is the header's size (§0.3). The
   count cap is what keeps that decision valid; without it the header transport degrades quietly.
4. **Nothing is acquired by default.** `gateway.tda.enabled: false` — a pipeline that can hold a gigabyte
   must be something you turned ON.

### 0.9.1 Placement and the compact trigger (owner ruling, 2026-09-19 — it supersedes §2.2's rationale)

Owner, verbatim:

> «Я вот что думаю, если TDA больше чем на один ход, то пусть они двигаюся по цепочке сообщений чтобы
> быть закешированными, потом они конечно исчезнут и мы получим частичную потерю кэша, но мы сэкономим
> токены на удержании. Но здесь один нюанс если мы залезаем на компакт, мы должны их тут же отпустить
> и информировать модель, модель сама решит что с этим делать, скорее всего приведет дела в порядок,
> сделает компакт и захватит файлы снова.»

**Placement: the item rides the MESSAGE CHAIN, not a re-appended tail block.** §2.2 argued the opposite —
appending to the mutable tail keeps the prefix untouched — and that argument is right about the PREFIX and
wrong about the BILL. Measured in §0.10's own terms: a tail block is re-sent every turn at FULL input
price, while a payload that has entered the chain costs `cache_read` (1/50 on our models). A hold longer
than one turn therefore wins by the ratio itself; «сэкономим токены на удержании» is that arithmetic, not
a preference.

**The release is where the cache is paid — and it is paid ONCE.** Withholding removes the payload from
inside that message, so the prefix changes at that point: «частичная потеря кэша», accepted deliberately —
once, versus every turn. Note that this is EXACTLY what the built transform already does (find the payload
by digest, replace it in place with a pointer), which is why the transform is PLACEMENT-AGNOSTIC: prefix
or tail, it matches by content and rewrites where the payload sits.

**Compaction is a HARD release trigger.** «если мы залезаем на компакт, мы должны их тут же отпустить и
информировать модель» — at the fold boundary every held item is released and the model is TOLD, because the
pointer stands exactly where the payload was: it reads `[… — released; <reader>(id=…) to attach it again]`
and decides for itself. The expected behaviour, in the owner's own words, is that it «приведет дела в
порядок, сделает компакт и захватит файлы снова» — the release is not a loss for the runtime to repair, it
is a decision handed to the model with everything needed to make it.

⇒ Two consequences for the task list:
- the ACQUIRER mints a MESSAGE (or a part inside one), not a tail block — §2.2's mechanism is superseded
  together with the reason it gave;
- a **bulk release at the fold boundary** becomes a runtime duty, in the same seam this session already
  touched (`session/prompt.ts`: `CompactionRequest.take` → `foldDecision`), so the release and the fold are
  decided in one place rather than by two mechanisms that could disagree.

### 0.10 The economics — the grep loop COMPOUNDS, and the window fouls (owner, 2026-09-19)

Owner, first pass (verbatim):

> «Может показаться это дороже - нет если файл большой будет кажем 50 грепов столько же reasoning и как
> следствие это будет во много раз дороже при том что шанс на получение результата будет низким.»

Owner, correcting this section (verbatim):

> «Почему я сказал про 50 грепов - 50 грепов это как минимум 50 раз переиспользования кэша и засранное
> окно контента потом вообще без компакта ничего не сделать. Ведь захватив файл на один ход следующим
> ходом можно написать про него все, даже то о чем файл сам о себе не знает.»

The first draft compared 50 turns against 1 acquire and stopped there. That understates it in three ways,
and each clause of the correction names one:

**1. The cost COMPOUNDS.** A fragment is not paid for once: its miss price lands on the turn that produced
it, and then its tokens are re-read on EVERY later turn — which is exactly what a 99 % cache hit rate
means. For a fragment of `F` tokens added at turn `t` of a session of `T` turns:

```
cost = F·M + F·H·(T − t)      M = miss, H = cache-read
     = F·H·(r + T − t)        because M = r·H
```

⇒ the LAST grep is cheap and the FIRST one is not: a grep loop buys its worst value first. The same
arithmetic is what makes an acquire cheap — `P·H·(r + held turns)`, with `held turns` = 2 instead of 50.

**2. The window fouls, and compaction is then FORCED.** «потом вообще без компакта ничего не сделать.»
A compaction is not free even when the summary is good: it rewrites the prefix once, and the summary is
Inferred prose ABOUT content the model could have read directly.

**3. One acquire, then the NEXT turn writes everything.** This is not economics at all: with the whole
artifact attended, the following turn can produce a SYNTHESIS — «даже то о чем файл сам о себе не знает».
Fragments never present the whole at once, so no sequence of greps reaches that; it is a capability
difference, not a price one.

On the prices measured tonight (`docs/compaction.md`, `r = input / cache_read = 50` on deepseek-flash):

| | a 1 MB source | the equivalent grep loop |
|---|---|---|
| turns | 1 acquire + 1 write-up | ~50 |
| cost | `P·(M + 2H)` — once, then nothing after the release | `Σ F·H·(r + T − t)` — compounding, worst value first |
| window | clean after the release | fouled; a compaction is the only way back |
| output | a synthesis of the WHOLE artifact | a sequence of fragments |

**Honest caveat:** the PRICE gap depends on `r` — widest on a deep-cache route like ours, vanishing where
there is no discount. The TURN-COUNT gap, the forced compaction and the synthesis capability do NOT depend
on `r` at all — which is why this is not an optimisation on the route we happen to use.

**Reverse engineering is the extreme case** the owner named («а если заниматься reverse engineering, так
тут вообще раздолье»): there the artifact cannot be summarised into fragments at all, because the REASON
for every line is what is being reconstructed. That is the shape a grep loop cannot do and an acquired
hold does by construction.

## 1. What exists today (grounded)

- **The link is already visible to the model.** `prompt.ts:1455` emits
  `[Attached file: ${filename} (${mime})]` in place of a `file` part. `compaction.ts:200,1001` do the
  same when rendering media into a summary (`[file: name (mime)]`). So the agent already has the
  inventory in its transcript — the owner's «линки у тебя в списке есть».
- **The bytes are already in the part.** A media part carries
  `url: "data:<mime>;base64,…"` (`prompt.ts:1612-1614`, `message-v2.ts:988,1057,1221,1244`,
  `tools.ts:421-432`). Re-attaching therefore needs **no store** — the payload is one property away.
- **Media is deliberately NOT counted or tokenised.** `compaction.ts` renders only the placeholder;
  the price comes from `estimateMediaTokens` (dimensions for images, duration for video).
- **WebP is already the encoding.** `attachment/handlers/image.ts` rewrites every image to WebP, which
  is why `keeps clipboard image parts for vision-capable models` is red (it expects PNG). That test is
  now WRONG by ruling — see §5.

## 2. Design

1. **Images ride in content, as webp.** No file store, no reference indirection, no derived-copy
   fallback. The base64 webp is the content.
2. **A tool re-attaches on demand.** `ids: [1,2,3]` → those images' payloads are appended to the
   **mutable TAIL** of the request, not into the prefix. Appending to the tail is what keeps
   `@KV_CACHE_STABILITY` intact: everything before stays byte-identical, so the cache holds.
3. **De-actualize is the same tool with an empty list** (or an explicit `detach`), dropping previously
   appended images so they stop occupying the window.
4. **No caching.** Nothing is persisted to make a re-attach cheaper; the bytes are read from the part
   that already holds them.
5. **Numbering** — open decision, see §4. The tool's contract depends on it.

## 2.1 What the appended frame SAYS (owner, 2026-09-19)

Owner: «актуализатор должен писать так: шот от такого-то линка, изображение… — тогда трансформер их
свяжет и у тебя вообще никаких сложностей не будет.»

An image appended to the tail with no caption is a floating picture: the model cannot tell which entry
in the transcript it belongs to. So every appended frame carries ONE synthetic line above it:

```
[Actualize #3 — from [Attached file: clipboard.png (image/webp)], message at 2026-09-19T07:31:26Z]
<the image part>
```

Three parts, and every one of them is DERIVED at actualize time rather than stored:

| field | where it comes from |
|---|---|
| `#3` | the stable session-wide ordinal (see §4.1) |
| the link text | the same string the transcript already shows, so the two match character for character |
| the time | `filePart.messageID` → that message row's `time_created` |

### Fact check on the timestamp — images have none today
- `message-v2.ts:97` — `partBase = { id, sessionID, messageID }`: **no time**.
- `message-v2.ts:203-248` — `FilePart` adds `mime`, `filename`, `url`, `source`, `dimensions`,
  `durationSeconds`: **still no time**.
- `prompt.ts:1679` — `if (part.type === "text" && !part.synthetic)` gates the `UTC: <iso>` suffix, so the
  synthetic lines that DESCRIBE an image are explicitly skipped.
- The DB row has `time_created` (messages are ordered by it), so the time exists in storage but appears
  **nowhere the model reads**. (The retired image-store plan's rule — "bytes by content, occurrence by
  timestamp" — was never implemented.)

⇒ **Do not add a field to `FilePart` for this.** The time is reachable from `messageID` at the moment of
composition, and a derived value cannot drift from the part it describes. (If it ever had to be stored,
it must travel through `filePartFromNormalized`, the single constructor — the rule from 2026-09-18.)

## 2.2 After a fold the SUMMARY becomes the index — three consequences

Owner, 2026-09-19: «после компакта актуализатор тебе сразу покажет скриншот из линков которые были в
компакте — на лету. Потери внимания — 0.»

The link that survives a fold is rendered by a DIFFERENT code path than the one at ingestion:

```
prompt.ts:1455        [Attached file: <name> (<mime>)]        ← at ingestion
compaction.ts:200,1001 [file: <name> (<mime>)]                ← into the summary
```

So after a fold the **summary is the index the agent reads**, and three things follow:

1. **~~The summary must render the ordinal~~ — CORRECTED: it already does, with no code change.**
   Grounded end to end, three links, each read rather than inferred:
   - **written** — `prompt.ts:1757` runs `sessions.updatePart(part)` for EVERY part in the array, and
     the caption is in that array (`:1707`), receiving its `id` from `assign`.
   - **schema-valid** — `prompt.ts:1742-1754` runs `MessageV2.Part.zod.safeParse(part)` and logs
     `invalid user part before save` on failure. `message-v2.ts:122-142` shows `TextPart` requires
     `id`, `sessionID`, `messageID`, `type: "text"`, `text`; the caption has exactly those plus
     `synthetic`, which is optional. So the parse succeeds and no error is logged.
   - **rendered** — `compaction.ts:179` and `:982` both carry «Render ALL text parts regardless of
     `ignored` flag», `:235` counts them the same, and a grep for `synthetic` in `compaction.ts`
     returns no filter on any rendering path.
   ∴ the ordinal reaches the summary because it was frozen into the text at ingestion — which is the
   whole reason for freezing it there. The plan's original claim (that the summary renders only the
   `file` part) was wrong: the summary renders the `file` placeholder **and** the caption, two lines
   for one image.

   **The real gap this leaves: images ingested before the caption existed** (every session so far).
   Their summary link carries no number and nothing can invent one per-message. This is exactly what
   the session-vs-summary split below is for — the tool must offer `list`, which is not a convenience
   but the only way to address an image whose caption was never written.
2. **The ordinal must be DERIVED, not counted.** The summary renders links to parts that are no longer
   in the window, so a counter that lived with the window is useless here. "Position in document
   order" is correct for a part regardless of whether it is still visible — which is a REASON for the
   §4.1 choice, not merely a preference.
3. **The summary is an index, not the inventory.** If compaction ever trims the link list, the payload
   still exists but its address is gone — the picture is there and cannot be requested. So the tool
   must enumerate from the **session**, not from the summary:

   | | what it is |
   |---|---|
   | summary | what is VISIBLE in the prompt — the index |
   | session | what is ADDRESSABLE — the authoritative inventory |

   The summary is what the agent happens to see; the session is what it can ask for. Conflating them
   is how an image becomes unreachable while still being stored.

**Why the loop loses no attention:** the summary keeps the LINK (so the agent knows the picture exists)
and drops the BYTES (so nothing dilutes the window). The frame returns only when the work needs it, and
leaves when the work is done — relevance decided by the agent, size bounded by the fold.

## 2.3 The append mechanism EXISTS, the removal one does NOT — so the shape is an active set

Grounded in the tool layer:

```
tool/tool.ts:32   attachments?: Omit<MessageV2.FilePart, "id" | "sessionID" | "messageID">[]
tool/read.ts:283,340,361   the read tool returns images and video frames exactly this way
tool/webfetch.ts:151       same
```

So a tool result can carry attachments and the runtime turns them into conversation parts — i.e.
"append to the tail" needs **no change to request assembly**. That is the good half.

**The bad half, and it is decisive:** a part that has entered the conversation is immutable. There is
no removal path except the fold. A second `actualize` therefore adds ANOTHER message; it does not
replace the previous frames. Repeated actualize/de-actualize cycles would ACCUMULATE, which walks
straight back into the 168 MB failure mode (§9). **Append-only cannot satisfy «деактуализируешь».**

### Decision (owner's advice, grounded): do it AT THE GATEWAY — one transform, not five layers

Owner, 2026-09-19: «Все такие приблуды надо делать на уровне гейтвея и не парить себе мозг.»

Grounded, and it is not merely a preference — the interception point already exists and already does
exactly this shape of work:

```
adaptive-client.ts:332   export function wrapFetch(_baseFetch)                       ← installed by mod.ts:79
adaptive-client.ts:162   export function rewriteReasoningContent(body: string): string {
                           const parsed = JSON.parse(body)
                           const messages = parsed.messages ?? []
                           for (…) messages[index] = rebuilt          ← walks and rewrites messages[]
                           return body                                ← a pure body → body function
                         }
adaptive-client.ts:347   applied per request for z-ai/glm/deepseek
provider.ts:1639         gatewayModel: model.id  ← what that condition tests
```

And the gateway can key on the SESSION — but **the header that carries it depends on the provider**,
which a read of the block corrects:

```
llm.ts:961-968   x-opencode-session is sent ONLY when providerID.startsWith("opencode")
                 ⇒ for our own deepseek/deepseek-flash it is NOT SENT AT ALL
llm.ts:957-959   x-request-id / x-session-id / x-session-affinity
                 x-session-id = providerID === "openrouter" ? providerCacheKey : input.sessionID
                 ⇒ for deepseek the session rides in x-session-id
adaptive-client.ts:376  the gateway already knows both names
```

So the transform must resolve the session from **`x-opencode-session` OR `x-session-id`**, and must not
assume the opencode-only one. (This corrects what I first wrote here from a partial read.)

### The modality gate — the owner's one condition, and how this layer expresses it
Owner, 2026-09-19: «Единственное мы должны проверять модальность — можно или нельзя.»

**The gateway does not look up models; it reads facts from headers.** That is the established shape:

```
adaptive-client.ts:389-398   reads x-opencode-provider, x-opencode-model, x-opencode-endpoint-kind,
                             x-opencode-has-tools, x-opencode-max-tokens, x-opencode-context-tokens,
                             x-opencode-has-attachments
llm.ts:944-979               where those headers are composed, with `input.model` in hand
```

So the modality verdict must ARRIVE as a header, decided where the model object exists — the same
predicate already used at `prompt.ts:1411` (`mdl.value.capabilities?.input?.image`) and named once in
`media-token-calibration.ts:40` (`modelSupports`). Injecting a frame into a request for a model that
cannot take images is exactly the provider-side 400 this design exists to avoid, and the refusal must
be local.

**Not verified, and worth one check before implementing:** `x-opencode-has-attachments` is READ at
`adaptive-client.ts:398` and I found no writer in the header block — it may come from the `...headers`
spread. If it truly has no writer, that read is dead, and it is the natural place to hang the modality
verdict rather than inventing a second flag.

### CHECKED — and it is worse than "one dead read": FIVE reads, ZERO writers

Grepped the whole package for the family. Every one of these is read by the gateway and written by
NOTHING:

| header | read at | consequence |
|---|---|---|
| `x-opencode-endpoint-kind` | `:391` | always the default `"chat"` |
| `x-opencode-has-tools` | `:394` | `hasTools` is **always false** |
| `x-opencode-max-tokens` | `:396` | `maxTokens` is **always undefined** |
| `x-opencode-context-tokens` | `:397` | `contextTokens` is **always undefined** |
| `x-opencode-has-attachments` | `:398` | `hasAttachments` is **always false** |

`classify()` therefore runs on constants, and the ladder collapses at its SECOND rung:

```
classifier.ts:26  hasAttachments        → false   ⇒ "file_attached" UNREACHABLE
classifier.ts:27  hasTools && max>1000  → false   ⇒ "long_codegen_stream" UNREACHABLE
classifier.ts:28  if (streaming) → "stream_default"   ← every streaming request lands HERE
classifier.ts:29  hasTools              → false   ⇒ "tool_planning" UNREACHABLE
classifier.ts:30  contextTokens > 50k   → undefined ⇒ "large_context_sync" UNREACHABLE
classifier.ts:31  maxTokens < 200       → undefined ⇒ "tiny_sync" UNREACHABLE
```

**Four of the five shape classes are dead**, and the gateway cannot tell a tool-planning turn from a
100k-context turn from a file-attached one. Only `streaming` is genuinely derived (from the body,
`adaptive-client.ts:249`).

### So the modality gate needs NO new surface — it needs the missing WRITER
`x-opencode-has-attachments` is exactly the right hook and is already read. One writer in the header
block of `llm.ts` (`:944-979`, where `input.model` is in hand) computing
`input.model.capabilities?.input?.image === true` — the same predicate `prompt.ts:1411` and
`media-token-calibration.ts:40 modelSupports` already use — does three things at once:

1. gives the gateway's `applyActiveFrames` its **modality verdict** (inject or refuse **locally**);
2. **revives `file_attached`** and, with siblings for the other four, the whole classifier;
3. introduces no new surface — it connects a read that was always there.

Recorded as a DEFECT as well as a design input: five readers with no writer is the same class the whole
project is fighting, and it has been silently shaping gateway routing.



**So the whole design collapses to one function:**

1. a pure `applyActiveFrames(body, active)` next to `rewriteReasoningContent`, keyed by
   `x-opencode-session`, which (a) **drops** media payloads from `messages[]` — the default becomes
   caption-only, for every model, and (b) **injects** the active set's frames at the end of `messages[]`;
2. the tool (`list` / `actualize` / `deactivate`) only edits the active set for that session — it never
   touches the request, the ingestion path, the summary or the assembly;
3. the set lives in the store under a namespace, surviving folds.

**Why this is the right shape, not just the easiest:** removal comes free (a frame not in the set is
simply not injected), the KV prefix stays byte-identical because only the tail changes, and there is
ONE place to look when a frame is missing. The five-layer version I had planned — ingestion → schema →
summary → assembly → tool — existed only because I was looking for the mechanism from the inside
instead of at the boundary.


## 3. Where it plugs in

| concern | site |
|---|---|
| the inventory the agent reads | `prompt.ts:1455` (and the compaction placeholders) — **unchanged**, already correct |
| reading the payload back | the `file` part's `url` (`data:…`) — a getter, not new storage |
| appending to the tail | request assembly for the next turn; the appended block must be the LAST content before the response is requested |
| de-actualizing | the same assembly, dropping the appended block |
| pricing | `estimateMediaTokens` — an appended webp is priced like any other image (dimensions), so the window budget keeps seeing it |

## 4. Open decisions

1. **Numbering — DECIDED: session-wide, stable `1..N`.** Owner, 2026-09-19: «ты всегда найдёшь что
   надо, потом актуализируешь…» — a memory note can only name an id that means the same thing later,
   so the id must outlive the window. It is PRINTED NEXT TO THE LINK (`[Attached file: #3 …]`), because
   the agent can only ask for the number it can read. A visible-list index is rejected: "3" would mean
   a different picture after the window moves.

### 4.1 The relevance ledger — the part that makes it attention, not just size

Owner, 2026-09-19: «у тебя всегда будут только те скриншоты которые тебе нужны, а остальных не
будет — внимание размываться не будет вообще.»

This is the point of the whole design, and it is an ATTENTION property, not a budget one: an
irrelevant image is not merely expensive, it is noise in the attended window.

- **Permanent memory holds the ledger** — which ids are live and WHY (which task they belong to).
  `reasoning.md` is inlined into `m*` verbatim, so the ledger survives compaction; a summary would
  not be enough.
- **Session history is the recovery path.** Memory is the accelerator, not the source of truth: an id
  forgotten can be recovered with `messagesearch`/`sessionread` and re-actualized. Forgetting costs a
  lookup, never data — which is what makes the discipline safe to rely on.
- **De-actualize when the work is done**, so the next window contains only the images the next task
  needs.

2. **Cap.** How many images may be active at once before the tool refuses (e.g. 6 at ~997 tokens each).
3. **Auto-detach.** Whether the tail block is dropped automatically at a fold, or only by the tool.

## 5. Cleanup this ruling requires

- `plans/2026-09-18_attachment-image-store.md` → superseded; move to `obsolete/` (reference only) or
  annotate as dead at the top. I1–I4 are not to be implemented.
- `packages/opencode/test/session/prompt.test.ts:2228`
  (`keeps clipboard image parts for vision-capable models`) must assert **WebP**, not PNG. This is the
  red that blocks push, and the ruling settles it: the ingestion path is correct, the test is stale.

## 6. Smoke Tests

- **S1** `bun typecheck` (packages/opencode) exit 0.
- **S2** The stale clipboard test asserts webp and the prompt suite is green — this is the
  push-unblocking oracle.
- **S3** Tool round-trip: with an image in the transcript and its bytes NOT in the window, calling the
  tool with that id puts the payload into the request; the next response can describe the picture.
  Falsifier: ask about a detail that is only in the image.
- **S4** De-actualize drops it: after calling with an empty list, the same question is no longer
  answerable from context — proving the block is gone rather than merely hidden.
- **S5** Cache: the system prefix hash is unchanged across an actualize/de-actualize pair (the tail
  moves, the prefix does not).

## 7. CUA frames are first-class images (owner, 2026-09-19)

Owner: «надо чтобы актуализатор автоматом цеплял твою работу с CUA как доп фреймом».

A CUA capture already lands as a file (`get_desktop_state` / `zoom` /
`browser_*` with `screenshot_out_file`), and the driver has a trajectory recorder
(`start_recording` → per-turn folders). So a CUA frame needs no new mechanism: it enters the SAME
inventory as an uploaded screenshot, gets a stable id, and is **attached automatically to the tail**
while the CUA work is in progress — no explicit request needed. `zoom` is the natural frame extractor:
it returns a rectangular region of a window at native resolution, which is what a "frame" is.

### Verified before designing it (2026-09-19)
- **Background capture works and does not disturb the foreground.** `get_desktop_state` →
  `exit 0`, **2560×1440 true screen pixels**, artifact read back, with the owner's TUI still frontmost
  and still working. `launch_app` is documented `SW_SHOWNOACTIVATE` ("does not steal focus"), and
  `press_key`/`type_text` deliver via `PostMessage`.
- **Trap: `list-tools` answers WITHOUT the daemon.** It is served from the local binary catalog, so a
  responding tool list is NOT proof that the driver is up. Only a real `call` proves it — the first
  attempt failed with `daemon is not running on \\.\pipe\cua-driver`.
- **Defect worth fixing separately:** on that failure the tool still printed
  `Exit 1. Screenshot written to <path>` while **no file existed** (verified by reading the path back).
  A success message emitted before the work is done is the same class as the silent `catch {}` this
  repo already forbids.
- The daemon must be started as `cmd_runner start -- bin\cua.cmd serve` (never a bare shell), and
  reports `listening on \\.\pipe\cua-driver`.

### The frame's real cost, measured through the product's own pipeline (2026-09-19)

Ran `ImageHandler.classify` + `.normalize` — the actual code, not a re-implementation — over every
image in `.opencode/shots/`:

| source | in | out | ratio |
|---|---|---|---|
| **`cua-desktop.png`** (CUA) | 783 087 B, 2560×1440 | **126 236 B, 2000×1125** | **0.161 — 6.2× smaller** |
| TUI screenshots (8 files) | 22–69 KB, ≤1543 wide | — | 0.60–0.99 |

Every output is `image/webp`, the 2000 cap holds, and the aspect is exact (2560/2000 = 1440/1125 =
1.28). Output dimensions — not the source's — are what travels forward, so the budget sees the truth.

**Two consequences for this design:**
1. **A CUA desktop frame costs 997 tokens**, not its file size: 2000×1125 = 2 250 000 px →
   `clamp(pixels/1700 + 36, 187, 997)` → 1359 → capped at **997**. The same as any large image. File
   size is irrelevant to the price, which is why attaching frames on demand is affordable.
2. Inline cost is base64 — 4/3 of bytes (126 236 B → 168 339 chars) — but the budget prices
   DIMENSIONS, so the actualizer's cap should be expressed in **frames**, not bytes.

**Honest caveat, reported rather than hidden:** on small TUI screenshots webp gains almost nothing
(0.60–0.99; one file is a wash at 0.994). That is content, not a pipeline defect — a flat dark
background with thin text is already near-optimal for PNG, while a desktop capture is exactly where
PNG is weak. Raising `quality` would make those files bigger; lowering it would blur the text. If
those ever need to shrink, the untested candidate is lossless webp, which needs its own measurement
before anyone claims it helps.

## 9. The failure mode this replaces — and the bound it therefore must carry

Owner, 2026-09-19: «большое приложение может насобирать 1000 скриншотов — начало работы будет очень
хорошим, а потом всё упадёт, потому что запрос будет весить 100 мегабайт, нас провайдер пошлёт.»

Arithmetic, from the measured frame: one frame is `126 236 B` → base64 **168 339 chars ≈ 168 KB**, so
**1 000 frames in the window ≈ 168 MB in ONE request**.

### Where it bites TODAY, before any actualizer (grounded in code)
`prompt.ts:1412-1421` — when the model can take images, the part is returned as-is, so **every stored
image rides every request**. For a vision model, a hundred screenshots in the window are a hundred
screenshots on the wire, every turn. Fixing this is not a nicety: it is what makes a long session
survivable.

### The rule that inverts
| | today | after |
|---|---|---|
| default | bytes always (vision models) | **caption only, for everyone** |
| on demand | nothing | `actualize(ids)` appends N frames to the tail |
| bound | none | an explicit cap on frames per request |
| when exceeded | the PROVIDER rejects | **the runtime refuses locally** |

**The bound must be local.** A provider rejection is an error we cannot enumerate ahead of time, and
it costs a round trip to discover. A local refusal reads as "too many frames, drop some" and costs
nothing. The cap is expressed in **FRAMES, not bytes** — price follows dimensions (997 tokens/frame),
so bytes are not the currency the budget uses.

### Measurement 1 — ANSWERED: the fold DOES eat image parts
Owner, 2026-09-19: «Съедает как положено — ты же сам сказал что не видишь скриншотов чтобы кодить,
ты начал кодить, а потом шот в ссылку превратился, кодить стало невозможно.» Corroborated by my own
record from this session: screenshots I had just been reading became `[file: …]` links mid-task.

**So a bound already exists — and it is the wrong kind.** The fold removes images from the wire when
the WINDOW fills, which is a question about size; the work needs them until the TASK is done, which is
a question about relevance. Coupling the two means images disappear exactly while they are still being
used. That is the defect being fixed, and it is why "just always send the images" is not an option:
it trades a wrong-timed removal for a 168 MB request.

**This is what makes keeping the payload (`935b803d46`) load-bearing.** Before it, a fold lost the
picture for good; now the fold merely takes it off the wire, and the payload is still in the session
for the actualizer to put back. The fold and the actualizer are complements: one bounds size, the
other answers need.

Not yet read in code: the exact mechanism by which the fold omits the part (whether it drops the
message or rewrites it) — the behaviour is confirmed by experience, the implementation is not.

### What still needs measuring before the cap is chosen
- The provider's real per-request size ceiling, if it publishes one, rather than guessing at "100 MB".

## 8. Related surface found while verifying — the prompt footer has its own gauge

The sidebar gauge is fixed, but the **prompt footer** prints `466.6K (47%)` — `tokens / context`
(466 633 / 1 005 808) while the sidebar now prints `49% of fold budget` (466 633 / 957 232). A THIRD
surface, same word, different denominator. Not in this plan's scope, recorded so it is not mistaken
for a regression of the sidebar fix.

## 10. Temporary data acquisition — the generalisation (owner, 2026-09-19)

Owner, verbatim:

> «долелываем наш пайплайн с картинками, хотя вообще давай его расширим до temporary data aquisition.
> Например документ — окей мы сним будем возиться 3 хода, все отпустили, кстати - включая исходники,
> иногда лучше цепануть несколько исходников и поправить где надо, а потом отпустить и сделать отчет.
> Дифы покажут правки.»

This is not an image feature. A screenshot, a document and a set of source files are the SAME shape —
external content brought into the attended window for a bounded purpose, worked on, then let go — and
§2.3 already named it: *an active set*. §1–§9 stay as the image instance and its grounding.

### The shape in four verbs (full design: `docs/content-lifecycle.md`)

| verb | for a tool result | for an attachment |
|---|---|---|
| acquire | the result arrives (`read`, `webfetch`, `codegraph`, …) | `read` media / an upload / a CUA frame |
| hold | for the whole user turn (`afterMessageID` gate) | **missing** |
| release | `> 8 000` chars from an earlier turn → placeholder; `recall(…, keep: true)` → a slice | **missing** |
| re-acquire | `recall(id, range, pattern)` | **missing** (the actualizer of §2–§3) |

So the non-media half is SHIPPED — sources read via `read`, search results and codegraph packs all
arrive as tool results, so they already have an address, a placeholder and a re-acquire. This plan does
NOT need to invent that half; it needs to (a) use it on sources deliberately and (b) build the
attachment half.

### What the generalisation ADDS

1. **A lifetime.** Today a release happens by SIZE (over the threshold, earlier turn) or explicitly
   (`keep`). Temporary acquisition needs the third trigger: *held for the next N turns, or until
   released*. This answers §4 decision 3 (“auto-detach at a fold, or only by the tool”): neither — the
   span is declared and expires, with the fold as an upper bound.
2. **One set, not one per type.** The active set holds ids of any acquired item — frame, document,
   source — and the release is one operation for all of them. §4.1's numbering rule (session-wide,
   stable, printed next to the link) is what makes an id mean the same thing after the window moves.
3. **The report IS the release.** «а потом отпустить и сделать отчет. Дифы покажут правки.» Letting go
   of a working set is the moment to state what changed, and the evidence is the RECORDED diffs —
   fossil leaves and tool `filediff`s — not a recollection of them. The same rule as “verify a write by
   reading the artefact back”, applied to a whole set.

### Tasks (each independently smoke-testable)

- **T1 — the hold.** An acquired item carries an expiry in turns. Oracle: with an expiry of 1, the item
  is in the request after acquisition and gone a turn later, while recovery by its id still returns it.
  Falsifier: an item that outlives its span, or one that is dropped leaving no address.
- **T2 — the attachment release.** The actualizer's de-actualize leg (§2–§3): the appended block is
  dropped by the same transform that appends it, and a repeated cycle does not ACCUMULATE.
- **T3 — sources as one acquired set.** Several `read` results held as a working set, narrowed with
  `keep` where useful, released together. Oracle: after the release the sources are gone from the
  window, and the edits they drove are visible in `git diff` and in the fossil leaves.
- **T4 — the report.** At release, the set's diffs are emitted as the report's evidence. Oracle: the
  report names files the snapshot actually shows changed — checked against `git status`, not recalled.

### Open decisions (the owner's)

- **Span units.** Turns, wall-clock, or “until the task's plan completes”? Turns is measurable today;
  a plan-keyed span matches «будем возиться 3 хода» more faithfully but couples this to plan state.
- **Where the set lives.** Permanent memory (the §4.1 ledger) is inlined into `m*` verbatim and so
  survives a fold — but it is prose the model must keep correct. A keyed store on the SQLite plane would
  make the set READABLE rather than remembered. Not decided.
- **Whether a release is ever automatic.** A span can expire by itself, or only the model may release
  and a forgotten set keeps costing. The falsifiers differ: a model-released set can be forgotten, an
  expiring one can drop what is still needed mid-task.

