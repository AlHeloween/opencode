"""Smoke: replay the neighbor session's per-message token totals through the
T3 guard and the P8 candidate (accumulated per-message delta) to verify which
one would have caught the expensive 100K cold re-prefill.

Data: finish-step cache hit/miss events from
.opencode/data/log/1786724785599_log_ep-kneqk9-1786632248553436783_ses_ffee765c3ffeVxqP1Tb68pZMhN.jsonl
(messageID → inputTokens + cacheReadTokens, in chronological order).
"""

from __future__ import annotations

# (message_index, total_prompt_tokens = input + cache.read) per assistant message
MESSAGE_TOTALS = [
    59_567, 62_365, 63_167, 63_992, 65_200, 66_048, 70_200, 70_492, 70_684,
    73_008, 73_516, 74_078, 74_226, 74_484, 75_538, 76_891, 77_459, 77_616,
    78_498, 78_744, 94_948, 95_206, 98_874, 99_463, 99_587, 99_717, 99_937,
    100_058, 100_168, 100_351, 100_670, 101_307,
]
T3_THRESHOLD = 24_576
P8_THRESHOLD = 12_288  # per-message accumulated growth


def main() -> None:
    print(f"{'msg':>3} {'total':>8} {'Δmsg':>7}  T3(single-step)  P8(Δmsg>{P8_THRESHOLD//1024}K)")
    t3_fires = 0
    p8_fires: list[tuple[int, int]] = []
    for i, total in enumerate(MESSAGE_TOTALS):
        prev = MESSAGE_TOTALS[i - 1] if i > 0 else 0
        delta = total - prev if i > 0 else None
        # T3 as deployed fires only on a SINGLE STEP delta > threshold; per-message
        # deltas here are upper bounds of any single step inside the message.
        t3 = delta is not None and delta > T3_THRESHOLD
        p8 = delta is not None and delta > P8_THRESHOLD
        if t3:
            t3_fires += 1
        if p8:
            p8_fires.append((i, delta))
        print(
            f"{i:3} {total:>8} {delta if delta is not None else '—':>7}  "
            f"{'WARN' if t3 else '·':>16}  {'WARN' if p8 else '·':>18}"
        )

    print()
    print(f"T3 (current, per-step > {T3_THRESHOLD}): fired {t3_fires} times")
    print(f"P8 (candidate, per-message Δ > {P8_THRESHOLD}): fired {len(p8_fires)} times", p8_fires)
    print()
    # The expensive moment: three full misses at ~100K (messages 23-25) followed
    # the biggest growth (+16.2K at msg 20, 78.7K -> 94.9K).
    caught = any(delta > P8_THRESHOLD and i <= 22 for i, delta in p8_fires)
    print("VERDICT:", "PASS — P8 would have warned before the 100K cold re-prefill" if caught else "FAIL — P8 would not fire early enough")


if __name__ == "__main__":
    main()
