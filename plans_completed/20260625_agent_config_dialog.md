# Agent Configuration Dialog — Plan

**Created**: 2026-06-25T12:34  
**Goal**: Replace minimal `DialogAgent` (31 lines) with a rich per-agent config dialog showing model assignment, enable/disable, balance, and cache stats.

---

## Math Formalization

Given:
- `A = {a_1, ..., a_n}` — visible agents (mode ≠ "subagent" or user-visible)
- `M = {m_1, ..., m_k}` — available models across all providers
- `C: A → M ∪ {⊥}` — current model assignment per agent
- `E: A → {0, 1}` — enabled status per agent
- `B: Provider → Balance` — provider balance
- `S: Session → CacheStats` — cache hit/miss

Display for each agent `a`:
```
[color_swatch] [name] [current_model] [balance_indicator] [cache_rate] [enabled_toggle]
```

On agent select: `DialogModel({ targetAgent: a.name })` → update `C(a) = m'`.

## Structural Diagram

```
┌────────────────────────────────────────────┐
│  DialogAgentConfig                          │
│  ┌──────────────────────────────────────┐   │
│  │ Title: "Agent Configuration"         │   │
│  │                                      │   │
│  │ ── Primary Agents ──                 │   │
│  │ ● build      kat-coder-pro-v2   [✓]  │   │
│  │ ● plan       deepseek-v4-pro    [✓]  │   │
│  │ 🟢 orch      deepseek-v4-pro    [✓]  │   │
│  │                                      │   │
│  │ ── Subagents ──                      │   │
│  │ ● general    deepseek-v4-pro    [✓]  │   │
│  │ ● explore    kat-coder-pro-v2   [✓]  │   │
│  │ ● coder      kat-coder-pro-v2   [✓]  │   │
│  │ ● researcher deepseek-v4-pro    [✓]  │   │
│  │ ● media      (disabled)         [ ]  │   │
│  │                                      │   │
│  │ [Balance: $12.34 | Cache: 78% hit]   │   │
│  │                                      │   │
│  │ Keybinds:                            │   │
│  │  ENTER - change model                │   │
│  │  SPACE - toggle enable/disable       │   │
│  │  ESC   - close                       │   │
│  └──────────────────────────────────────┘   │
└────────────────────────────────────────────┘
```

## Input Parameters

| Param | Type | Source | Description |
|-------|------|--------|-------------|
| `agents` | `Agent[]` | `sync.data.agent` | All visible agents |
| `agentModels` | `Record<string, {providerID, modelID}>` | `local.model` store | Per-agent model assignments |
| `providerBalance` | `Map<providerID, Balance>` | `getModelStatus()` | Provider balance/wallet |
| `cacheStats` | `{ hitRate: number }` | sidebar context | Session cache hit rate |

## Output Parameters

| Output | Type | Effect |
|--------|------|--------|
| Agent model change | `local.model.set(model, {agent})` | Updates per-agent model |
| Agent enable/disable | `config.agent[name].disable` | TBD — local toggle or config write |
| No global state change | — | Dialog is read-only except for model/toggle |

---

## Implementation

### 1. Rewrite `dialog-agent.tsx`

**File**: `packages/opencode/src/cli/cmd/tui/component/dialog-agent.tsx`

```
- Read all visible agents from local.agent.list() (non-subagent, non-hidden)
- Group by mode: primary vs subagent
- For each agent:
  - Gutter: color swatch (circled dot in agent's color)
  - Title: agent name + description
  - Footer: current model name + provider OR "(no model configured)"
  - Right-margin: enabled/disabled indicator
- Keybinds:
  - ENTER/click: open DialogModel({ targetAgent: name })
  - Space: toggle enable/disable (local state via signal, future: write config)
- Footer section: balance and cache stats from provider/session
- Use DialogSelect with categories for grouping
```

### 2. Wire into existing keybinds

**File**: `packages/opencode/src/cli/cmd/tui/app.tsx`

Already wired at `agent_list` → `<leader>a`. No changes needed unless keybind is added for toggle.

### 3. Add enable/disable toggle (future)

For v1: local-only toggle via SolidJS `createSignal` map.  
For v2: persist via config write (`config.agent[name].disable = true`).

---

## Test Cases

| # | Input | Expected |
|---|-------|----------|
| 1 | `<leader>a` pressed | DialogAgentConfig opens with all visible agents grouped |
| 2 | Select build agent | DialogModel opens with targetAgent="build" |
| 3 | Pick model in DialogModel | Returns to DialogAgentConfig, model updated in display |
| 4 | Space on an agent | Toggle shows disabled state, agent removed from cycle |
| 5 | Balance display | Shows provider balance if available, "No balance" otherwise |
| 6 | Cache display | Shows session cache hit % if tokens have been consumed |

---

## Task Checklist

- [ ] Read current `dialog-agent.tsx` + `DialogSelect` API
- [ ] Read `dialog-model.tsx` for targetAgent pattern
- [ ] Read sidebar `context.tsx` for balance/cache data shapes
- [ ] Implement `DialogAgentConfig` component
- [ ] Wire up keybinds (ENTER = model select, SPACE = toggle, ESC = close)
- [ ] Add balance footer row
- [ ] Add cache stats footer row
- [ ] Typecheck
- [ ] Build + smoke test
