import { describe, expect, test } from "bun:test"
import { commandBatches } from "@/snapshot/fossil"

/**
 * Why the snapshot manifest is batched rather than splatted or iterated.
 *
 * `fossil add` and `fossil rm` both accept `FILE1 ?FILE2 ...?`, but the tracking
 * loop spawned one process per file — O(files) process creations, ~25ms each on
 * Windows, all of it while holding the repo lock and with the model loop waiting.
 * This session's own history carries turns with 231-252 changed files (60+ of
 * them) and outliers at 8_013 and 9_441.
 *
 * The opposite extreme does not work either: Windows caps a command line at
 * 32_767 characters, so one invocation for 9_441 paths is unspawnable. Hence
 * batches bounded by both length and count.
 */
describe("commandBatches", () => {
  const paths = (n: number, len = 40) => Array.from({ length: n }, (_, i) => `${String(i).padStart(len, "p")}.ts`)

  test("the common case is a single invocation", () => {
    // One or two edited files must not pay for the batching machinery.
    expect(commandBatches(["src/a.ts", "src/b.ts"])).toEqual([["src/a.ts", "src/b.ts"]])
  })

  test("nothing to track means nothing to spawn", () => {
    expect(commandBatches([])).toEqual([])
  })

  test("a realistic 252-file turn collapses from 252 spawns to 2", () => {
    expect(commandBatches(paths(252)).length).toBe(2)
  })

  test("the 9_441-file outlier stays bounded", () => {
    // Whichever bound binds first — for 40-char paths it is the character
    // budget at ~173/batch, not the 200 count — the result is two orders of
    // magnitude fewer spawns than one-per-file, with nothing dropped.
    const batches = commandBatches(paths(9_441))
    expect(batches.flat().length).toBe(9_441)
    expect(batches.length).toBeLessThan(100)
    for (const batch of batches) {
      expect(batch.length).toBeLessThanOrEqual(200)
      expect(batch.reduce((n, p) => n + p.length + 3, 0)).toBeLessThanOrEqual(8_000)
    }
  })

  test("no batch can exceed the character budget", () => {
    // The hard constraint: a batch over the limit is an unspawnable command.
    for (const batch of commandBatches(paths(500, 300), { maxChars: 8_000 }))
      expect(batch.reduce((n, p) => n + p.length + 3, 0)).toBeLessThanOrEqual(8_000)
  })

  test("a single path longer than the budget still ships, alone", () => {
    // Dropping it would silently lose a file from the snapshot; one oversized
    // command is the lesser failure and fossil reports it.
    const huge = "x".repeat(9_000)
    expect(commandBatches([huge], { maxChars: 8_000 })).toEqual([[huge]])
  })

  test("every path survives, in order", () => {
    const input = paths(1_000)
    expect(commandBatches(input).flat()).toEqual(input)
  })

  test("the count bound applies even when paths are short", () => {
    expect(commandBatches(paths(400, 1), { maxCount: 50 }).length).toBe(8)
  })
})
