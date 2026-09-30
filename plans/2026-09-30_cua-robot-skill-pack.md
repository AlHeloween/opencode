<!-- intention: the cua skill pack the robot reads is the vendor's, written for a networked install, and it still tells an agent to run `irm https://cua.ai/driver/install.ps1 | iex` -> the robot reads its own cua skill pack, rewritten in the reasoning-kernel's style (gated cycle, prediction, instrument qualification, status-marked measured facts), embedded in the offline build and indexed by the cua tool -->
<!-- goal_sv: skill-pack, kernel-style, measured-facts, offline-embedding, gui-debugging -->
# cua-robot skill pack — the kernel's discipline, applied to GUI work

```yaml
Keywords: skill-pack 0.30, kernel-style 0.25, measured-facts 0.20, offline-embedding 0.15, gui-debugging 0.10
Semantic dominant: A cua skill pack for the robot that turns today's measured lessons into a gated, predict-then-verify GUI cycle, embedded in the offline driver.
md5: 4d7a1e93c0b25f68e3a9d1c7b04f52e6
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 00000000000000000000000000000000
```

**Status:** ACTIVE — owner, 2026-09-30: «давай не будем копипастить, а творчески переработаем скилы для cua в стиле
кернела». Not a copy: the vendor pack (`external/cua/libs/cua-driver/rust/Skills/cua-driver/`) stays untouched for the
network build and is cited as prior art; the new pack lives beside it as `Skills/cua-robot/`.

## Design

- **One source, two consumers.** The offline build embeds `Skills/cua-robot/*.md` instead of the vendor pack
  (`cua-driver-core/src/mcp_skills.rs` under `#[cfg(feature = "offline")]`); `packages/opencode/src/tool/cua.ts`
  `skill-index` points at the same files.
- **Kernel form, GUI content.** SKILL.md is a gated cycle (intent → ground → qualify → predict → act bound → oracle →
  record), shared `@RULES`, and a failure map. Facts live in their own files, each with a status mark and evidence.
- **Windows only** (installer decision): no LINUX/MACOS/EMBEDDING files.
- Artifacts in English (kernel G9); the owner-facing reply stays Russian.

| File | Holds |
|---|---|
| `SKILL.md` | the cycle, the shared rules, the failure map, reading order |
| `WINDOWS.md` | measured Windows facts (capture, minimized, DPI, UIA coverage by toolkit, input routes) with run ids |
| `TIERS.md` | modes A/B and isolation tiers (web / virtual monitor / VMware), what each can and cannot prove |
| `RUNTIME.md` | the offline driver (zero egress, refused tools), private-pipe daemon lifecycle, cleanup, job runner |
| `DATA_ENTRY.md` | forms, grids, filters, irreversible commits — for data-entry apps (accounting, JView-like viewers) |

## Smoke Tests

- [ ] **K1 lint (read-only script):** every `@RULE` used is defined once; every measured-fact line carries ✓/✗ and a run id or `path:line`; no `| iex`, no `irm http`, no vendor URL as an instruction. Predicted on the draft: passes after authoring, fails on the vendor pack (`| iex` present). <!-- sv: lint, rule-references, evidence-marks -->
- [ ] **K2 embedding:** offline exe contains `name: cua-robot` and 0× `install.ps1 | iex` (today: 4×, from the vendor docs); default exe still embeds the vendor pack. <!-- sv: embedding, offline-build, binary-scan -->
- [ ] **K3 consumer:** `cua.ts` `skill-index` lists the cua-robot files; focused test in `test/tool/cua.test.ts`. <!-- sv: skill-index, cua-wrapper, focused-test -->
- [ ] **K4 outside falsifier:** an isolated free model (skill `aicall`) reads SKILL.md + WINDOWS.md and answers held-out scenarios («tool said ✅ Posted drag — done?», «capture_id on drag accepted — bound?», «minimized window, pixel click?»); predicted: answers match the pack; a mismatch is a wording defect in the pack. <!-- sv: outside-falsifier, reading-test, held-out -->

## Work

- [ ] **P1 author:** SKILL.md, WINDOWS.md, TIERS.md, RUNTIME.md, DATA_ENTRY.md. <!-- sv: authoring, kernel-style, measured-facts -->
- [ ] **P2 embed:** offline `mcp_skills.rs` include list → cua-robot; rebuild; K2. <!-- sv: embedding, mcp-skills, offline-cfg -->
- [ ] **P3 index:** `cua.ts` SKILL_GUIDES → cua-robot files; K3. <!-- sv: skill-index, cua-wrapper, guides -->
- [ ] **P4 falsify:** K4; fix the wording the outside reader misread. <!-- sv: outside-falsifier, wording, revision -->
