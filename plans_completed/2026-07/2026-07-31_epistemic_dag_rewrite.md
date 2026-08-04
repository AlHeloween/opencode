# Epistemic DAG Rewrite — `02_info_mark.py`

**Date:** 2026-07-31  
**Status:** plan  
**Scope:** `opencode_prompts_kernel/02_info_mark.py` (primary), ripple to `05_svm_anchor.py`, `06_contracts.py`, `11_state_record.py`, `13_bug_fix.py`, `16_example.py`, tests

---

## 1. Context / Goal

Текущий `InformationMark` — 5-float distribution с `dominant_level = max(coeffs)`. Это **numeric ranking**, а не эпистемическая модель. Нельзя перемножить non-working на миллион и получить working.

Правильная модель: **эпистемический DAG** (Directed Acyclic Graph), где каждый claim — это узел с одним из 5 состояний, зависимостями, и правилом «слабейшая зависимость = потолок вывода».

### Core principles (from user)
1. State before reasoning
2. Decompose before expansion
3. Reference outranks inference
4. Preserve provenance
5. Do not promote claims without verification
6. **Use the weakest dependency as the conclusion ceiling**
7. Separate incompatible standards
8. Emit the cleanest verified next state

### Node types (from user)
| Status | Node type | Meaning |
|--------|-----------|---------|
| Unknown | empty node | Нет evidence, нет структуры |
| Guess | candidate node | Существует, не проверено |
| Hypothetical | externally supported phantom | universalsearch кодом подтверждён |
| Inferred | dependency-linked derived | Связан с другими узлами через зависимости |
| Exact | scope-bounded verified | Oracle/test проверил в указанном scope |

---

## 2. Prior Art (REUSE.BEFORE)

| Source | Finding |
|--------|---------|
| TypeScript `constitution.ts` | Уже использует string enum `InfoMark`, не floats — правильный подход |
| `30_epistemic.py` | `ClaimNode` для research claims (definition, observation, measurement...) — другая цель, можно переиспользовать имя |
| `04_delta.py` | `DELTA_STABLE=0.3`, `DELTA_SHIFT=0.6` — остаются для SVM, не для epistemic |
| `24_specs_policies.py:127-131` | SVM NOISE rule — отдельная система, не затрагивается |

**reuse: N/A** — фундаментальный редизайн внутренней модели.

---

## 3. Design: Epistemic DAG

### 3.1 ClaimNode (replaces InformationMark)

```python
@dataclass
class ClaimNode:
    """Epistemic node in a dependency DAG. Not a float distribution."""
    id: str                              # unique claim identifier
    text: str                            # claim text
    status: ClaimStatus                  # single enum, not 5 floats
    scope: str = ""                      # what this claim is bounded to
    dependencies: list[str] = field(default_factory=list)  # IDs this claim depends on
    evidence: str = ""                   # what supports this claim
    falsifier: str = ""                  # what would disprove it
    source: str = ""                     # "oracle", "code_search", "web_search", "inference"
    verified_at: str = ""                # ISO timestamp of last verification
    label: str = ""                      # human-readable label (preserved from old API)
```

### 3.2 ClaimStatus enum

```python
class ClaimStatus(str, Enum):
    UNKNOWN = "Unknown"            # empty node
    GUESS = "Guess"                # candidate node
    HYPOTHETICAL = "Hypothetical"  # externally supported phantom
    INFERRED = "Inferred"          # dependency-linked derived
    EXACT = "Exact"                # scope-bounded verified
```

### 3.3 EpistemicDAG

```python
@dataclass
class EpistemicDAG:
    """Collection of ClaimNodes with dependency edges."""
    nodes: dict[str, ClaimNode] = field(default_factory=dict)

    def add(self, node: ClaimNode) -> None: ...
    def dependencies_of(self, node_id: str) -> list[ClaimNode]: ...
    def dependents_of(self, node_id: str) -> list[ClaimNode]: ...
```

### 3.4 Weakest-link ceiling (CORE RULE)

```python
def effective_status(node: ClaimNode, dag: EpistemicDAG) -> ClaimStatus:
    """A claim is at most as strong as its weakest dependency.
    
    Exact + Guess dependency → at most Guess.
    Inferred + Hypothetical dependency → at most Hypothetical.
    """
    if not node.dependencies:
        return node.status
    dep_statuses = [effective_status(dag.nodes[dep], dag) for dep in node.dependencies]
    weakest_dep = min(dep_statuses, key=lambda s: STATUS_ORDER[s])
    return min(node.status, weakest_dep, key=lambda s: STATUS_ORDER[s])

STATUS_ORDER = {
    ClaimStatus.UNKNOWN: 0,
    ClaimStatus.GUESS: 1,
    ClaimStatus.HYPOTHETICAL: 2,
    ClaimStatus.INFERRED: 3,
    ClaimStatus.EXACT: 4,
}
```

### 3.5 Promotion rules

| From | To | Gate |
|------|----|------|
| Unknown | Guess | Web search found relevant result |
| Guess | Hypothetical | Code search (universalsearch code) verified pattern |
| Hypothetical | Inferred | All dependencies at least Inferred, derivation nonempty |
| Inferred | Exact | Oracle PASS in declared scope |
| Exact | Guess | Oracle FAIL → demotion! Verifiability broken. |

### 3.6 Demotion rules

| Trigger | New status |
|---------|-----------|
| Oracle FAIL on Exact claim | Guess |
| Dependency demoted | Recompute via weakest-link |
| Staleness (freshness ≤ 0) | Unknown |
| Unresolved contradiction | Unknown |

### 3.7 Cycle: Exact→Guess→...

```
Exact → test FAIL → Guess → web search → Hypothetical → code verify → Inferred → oracle PASS → Exact
```

Этот цикл — фундаментальное свойство: **Exact не навсегда**. Verification scoped and perishable.

---

## 4. What changes in `02_info_mark.py`

### REMOVE
- `InformationMark` dataclass with 5 floats
- `dominant_level` property (max coefficient)
- `accuracy` property (weighted sum)
- `__post_init__` normalization
- `promote_information_mark` (already deprecated)
- `from_accuracy` classmethod on InfoMarkLevel (if exists)

### ADD
- `ClaimNode` dataclass (see §3.1)
- `ClaimStatus` enum (see §3.2)
- `EpistemicDAG` class (see §3.3)
- `effective_status(node, dag)` function (see §3.4)
- `promote_claim(node, dag, new_status, evidence)` — gated promotion
- `demote_claim(node, dag, reason)` — demotion with cascade
- `verify_claim(node, dag, oracle_pass, scope)` — oracle gate

### KEEP (adapted)
- `classify_claim_status` → rename to `classify_claim_node`, returns ClaimStatus, uses weakest-link internally
- `status_after_oracle_pass` → `verify_claim` (renamed, adapted)
- `confusion_matrix_validation` → keep (statistical evidence is still valid for Hypothetical→Inferred gate)
- `salience_from_mention_ratio` → keep (salience ≠ evidence, unchanged)
- `reverse_search` → adapt to ClaimStatus enum

---

## 5. Consumer Impact

| File | Current usage | Change needed |
|------|--------------|---------------|
| `05_svm_anchor.py` | `Signal.information_mark: Optional[InformationMark]` | → `Optional[ClaimNode]` or just `ClaimStatus` |
| `06_contracts.py` | Three dataclasses with `information_mark: Optional[InformationMark]` | → `Optional[ClaimStatus]` (contracts don't need full DAG) |
| `11_state_record.py` | `StateRecord.information_mark: InformationMark`, serialized via `asdict` | → `ClaimStatus` enum or `ClaimNode`; serialization format changes |
| `13_bug_fix.py` | `BugFixAttempt.information_mark`: constructed with float coefficients | → `ClaimStatus` enum, no floats |
| `16_example.py` | Constructs `InformationMark(exact=..., inferred=..., ...)` | → `ClaimNode(status=..., ...)` |
| `30_epistemic.py` | Has own `ClaimNode` for research claims — name collision | Rename research `ClaimNode` → `ResearchClaim` or keep separate namespace |
| TypeScript `constitution.ts` | Already uses `InfoMark` string enum | No change needed |
| TypeScript `memory.ts` | Stores `exact_coef`, `inferred_coef`, etc. in SQLite | **Compatibility**: keep columns, populate from ClaimStatus → coefficient mapping. Or migrate to store `status` string. |
| `tests/kernel/test_info_mark.py` | Tests float normalization, dominant_level, accuracy | Rewrite for ClaimNode/DAG tests |
| `tests/kernel/test_state_record.py` | Constructs `InformationMark(exact=0.85, ...)` | Update to new API |

---

## 6. Implementation Steps

### Phase 1: Core `02_info_mark.py` rewrite

- [ ] **1.1** Define `ClaimStatus` enum
- [ ] **1.2** Define `ClaimNode` dataclass (id, text, status, scope, dependencies, evidence, falsifier, source, verified_at, label)
- [ ] **1.3** Define `EpistemicDAG` class (add, dependencies_of, dependents_of)
- [ ] **1.4** Implement `effective_status(node, dag)` — weakest-link ceiling
- [ ] **1.5** Implement `promote_claim(node, dag, new_status, evidence)` — gated
- [ ] **1.6** Implement `demote_claim(node, dag, reason)` — with cascade
- [ ] **1.7** Implement `verify_claim(node, dag, oracle_pass, scope)` — oracle gate
- [ ] **1.8** Adapt `classify_claim_status` → `classify_claim_node`
- [ ] **1.9** Adapt `reverse_search` to ClaimStatus
- [ ] **1.10** Keep `confusion_matrix_validation`, `salience_from_mention_ratio` unchanged
- [ ] **1.11** Remove `InformationMark`, `dominant_level`, `accuracy`, `promote_information_mark`

### Phase 2: Update kernel consumers

- [ ] **2.1** `05_svm_anchor.py`: `Signal.information_mark` → `ClaimStatus`
- [ ] **2.2** `06_contracts.py`: three dataclasses → `ClaimStatus`
- [ ] **2.3** `11_state_record.py`: `StateRecord.information_mark` → `ClaimNode` or `ClaimStatus`; update serialization
- [ ] **2.4** `13_bug_fix.py`: `BugFixAttempt.information_mark` → `ClaimStatus`
- [ ] **2.5** `16_example.py`: use new `ClaimNode` API
- [ ] **2.6** `30_epistemic.py`: rename `ClaimNode` → `ResearchClaimNode` to avoid collision

### Phase 3: Update TypeScript compatibility

- [ ] **3.1** `memory.ts`: keep `exact_coef` etc. columns, map `ClaimStatus` → coefficients for backward compat, OR add migration
- [ ] **3.2** `semantic-vector.ts`: `classifyText` — map keyword-based heuristics to `ClaimStatus` instead of float coefficients
- [ ] **3.3** Verify `constitution.ts` — already string-based, no change needed

### Phase 4: Tests

- [ ] **4.1** Rewrite `tests/kernel/test_info_mark.py` for DAG model
- [ ] **4.2** Test `effective_status` — weakest-link ceiling (Exact+Guess→Guess)
- [ ] **4.3** Test promotion gates (Unknown→Guess→Hypothetical→Inferred→Exact)
- [ ] **4.4** Test demotion cascade (Exact→Guess on oracle fail)
- [ ] **4.5** Test cycle: Exact→Guess→Hypothetical→Inferred→Exact
- [ ] **4.6** Test staleness and contradiction demotion
- [ ] **4.7** Update `tests/kernel/test_state_record.py`
- [ ] **4.8** Update `tests/kernel/test_bug_fix.py` if needed

### Phase 5: Verify

- [ ] **5.1** `pytest tests/kernel/ -v` → все тесты pass
- [ ] **5.2** `bun test` в `packages/opencode` → без регрессий
- [ ] **5.3** Ручная проверка: демо-пример с DAG из 3 узлов

---

## 7. Smoke Tests

### Baseline (до изменений)

| # | Command (cwd) | Expected now | Actual [Exact] |
|---|---------------|--------------|----------------|
| 1 | `python -m pytest tests/kernel/test_info_mark.py -v --tb=short` (repo root) | 6 тестов pass (текущий float-based) | |
| 2 | `python -m pytest tests/kernel/ -v --tb=short` | Все тесты pass | |
| 3 | `bun test test/session/constitution.test.ts` (packages/opencode) | Все pass | |

### Post-implementation oracles

| # | Command | Pass criteria |
|---|---------|---------------|
| 1 | `pytest tests/kernel/test_info_mark.py -v` | Новые DAG-тесты pass |
| 2 | `pytest tests/kernel/ -v` | Все тесты pass, старые адаптированы |
| 3 | `bun test test/session/` (packages/opencode) | Без регрессий |
| 4 | Manual: `ClaimNode` DAG с циклом Exact→Guess→Exact | Корректный переход |

### Gate

- [ ] Smoke requirements written
- [ ] Baseline recorded [Exact]
- [ ] Implementation only after baseline
- [ ] Post-impl smoke passed before [x]

---

## 8. Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Поломка `memory.ts` FTS5 hybrid ranking (завязан на float columns) | **High** | Сохранить колонки, маппить `ClaimStatus` → coefficients для обратной совместимости |
| `30_epistemic.py` name collision (`ClaimNode`) | Low | Переименовать research `ClaimNode` → `ResearchClaimNode` |
| `11_state_record.py` serialization format change | Medium | `asdict` на `ClaimNode` даст другой JSON; проверить все readers |
| Не все promotion-гейты покрыты тестами | Medium | Исчерпывающий набор тестов в Phase 4 |

---

## 9. Design notes

### Why weakest-link ceiling?

```
Claim A: "memory leak fixed" [Exact — oracle passed]
Claim B: "no side effects" [Guess — model speculation]
Claim C: "safe to deploy" [derived from A + B]

effective_status(C) = min(Exact, Guess) = Guess
```

Нельзя получить Exact-вывод, если одна из посылок — Guess. Потолок вывода = слабейшая зависимость.

### Why Exact is scope-bounded?

"Exact" не означает "универсальная истина". Это значит "проверено oracle'ом в заявленном scope". Scope: "file X, function Y, lines 10-20". За пределами scope статус не определён.

### Why Exact→Guess on test fail?

Oracle FAIL означает, что verification больше не держится. Exact был «проверено в scope X». Если oracle в scope X теперь FAIL — verification сломана, доверие обнуляется до Guess. Цикл: Guess → search → Hypothetical → verify → Exact (или снова Guess).
