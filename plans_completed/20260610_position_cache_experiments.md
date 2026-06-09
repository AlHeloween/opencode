# Experiment: Position Sensitivity of DeepSeek Prefix Cache

Date: 2026-06-10  
Status: Plan — DO NOT IMPLEMENT until approved

## Goal

Determine exactly what affects DeepSeek's prefix cache: content, position, whitespace, or all three.

## Hypotheses

1. **Content**: Changing a token breaks cache from that point → CONFIRMED (Phase 1)
2. **Position**: Shifting content without changing it breaks cache at shift point → TO TEST
3. **Whitespace**: Extra spaces change token sequence → breaks cache → TO TEST
4. **Timestamps**: Frequently changing values at fixed positions → TO TEST

## Experiments

### Test A: Date at user message start (not system prompt)

**Purpose**: Prove that moving date FROM system prompt TO user message preserves system cache.

**Setup**:
```
System:  "You are a helpful assistant. Be concise."  (IDENTICAL in all requests)
User[0]: "Today's date: June 9, 2026.\n\nHere is context:\n" + 20 facts + "\nQuestion: summarize"
User[1]: same, but date = "Today's date: June 10, 2026."
User[2]: same, but date = "Today's date: June 11, 2026."
```

**Expected**: system tokens + "Today's date: June " = common prefix → HIT. Date digit → MISS. Facts + question → depends on whether DeepSeek creates separate prefix unit for the facts after the date.

**Measure**: `prompt_cache_hit_tokens` for each. Compare with Phase 1 (where date was in system prompt → 0 hits).

### Test B: 20 facts, fixed positions

**Purpose**: Prove that reordering facts breaks cache at reorder point.

**Setup**:
```
Request 1: system + "Context:\n- fact_01: Alpha\n- fact_02: Beta\n...\n- fact_20: Omega\n\nQuestion: list facts"
Request 2: system + SAME 20 facts, SAME order → should HIT all prefix
Request 3: system + same 20 facts, different question → should HIT facts prefix
Request 4: system + facts in different order (fact_05 ↔ fact_10 swapped) → should MISS at swap point
```

**Fact content**: 20 short strings like `"fact_01: The project uses TypeScript 5.8"`, each on its own line. Total ~200 tokens.

### Test C: Timestamp per message at fixed position

**Purpose**: Prove that per-message timestamps at the same position accumulate cache breaks.

**Setup**:
```
Request 1:
  system: "You are a helper."
  user[0]: "[2026-06-10 14:30:00] First question: what is TypeScript?"
  assistant[0]: "TypeScript is..."
  user[1]: "[2026-06-10 14:30:05] Second question: what is Node.js?"
  
Request 2 (same, timestamps incremented):
  system: same
  user[0]: "[2026-06-10 14:30:01] First question: what is TypeScript?"
  assistant[0]: "TypeScript is..."
  user[1]: "[2026-06-10 14:30:06] Second question: what is Node.js?"
```

**Expected**: system tokens HIT. First timestamp diverges immediately at seconds digit → MISS. assistant[0] content is same but at different ABSOLUTE token position → likely MISS. user[1] → MISS.

**Key question**: Does DeepSeek create cache units at MESSAGE boundaries, not just total prefix boundaries? If yes, assistant[0] might hit from its own prefix unit.

### Test D: Space-shift a middle message

**Purpose**: Prove that token position (not just content) matters.

**Setup**:
```
Request 1:
  system: "You are a helper."
  user[0]: "Question one"
  assistant[0]: "Answer one with some detail about the topic at hand."
  user[1]: "Question two"

Request 2:
  system: same
  user[0]: same  
  assistant[0]: "Answer one with some detail about the topic at hand.  " (two extra spaces at end)
  user[1]: same
```

**Expected**: system + user[0] HIT. assistant[0] content matches until the extra spaces. Tokenizer might produce different tokens for "hand." vs "hand.  ". After divergence → user[1] is MISMATCHED because its position shifted.

**Key question**: Does user[1] (identical content but at a different absolute token position) get cache hits? This proves whether positioning matters or whether DeepSeek does content-addressed caching.

## File

```
packages/opencode/test/experiments/20260610_cache_guardrail/phase1_position_tests.ts
```

Runs all 4 experiments sequentially. Each experiment:
1. Sends warm-up (request 1)
2. Waits 5s
3. Sends test (request 2)
4. Reports `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`

Output: JSON report with all test results + conclusions.

## Success Criteria

| Test | What proves the hypothesis |
|------|--------------------------|
| A | Date in user msg: system tokens hit, date tokens miss. Improvement over Phase 1 (where date in system killed ALL cache) |
| B | Same facts = hit. Reordered facts = miss at swap point |
| C | Timestamp divergence propagates through all subsequent messages → cumulative break |
| D | Space-shift breaks cache at shift point. Subsequent identical content at different position = MISS → position matters |
