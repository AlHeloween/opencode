import { describe, expect, test } from "bun:test"
import { vectorSign } from "@/memory/spine"

const vector = [
  "Keywords: dialogue-recovery 0.35, state-provenance 0.25, oracle-history 0.20, svm-gaps 0.12, fossil-linkage 0.08",
  "Semantic dominant: Восстановлен диалог T3 по SV и показаны недостающие связи состояния и различие исторического PASS с последующим FAIL.",
  "md5: c79e24b18f603ad5e2a890764bd1f3c6",
  "prev-md5: 8b7fa260c1e94d35a6f0289e73bc451d",
  "parent-goal-md5: 00000000000000000000000000000000",
].join("\n")

describe("snapshot vector signature", () => {
  for (const presentation of [vector, `\`\`\`yaml\n${vector}\n\`\`\``, vector.replaceAll("\n", "\r\n")]) {
    test("preserves the full roadmap instead of only its address and shortened dominant", () => {
      const sign = vectorSign(`Завершённый ответ.\n\n${presentation}`)
      expect(sign).toStartWith("sv:c79e24b18f603ad5e2a890764bd1f3c6 dominant=")
      expect(sign).toEndWith(`\n\n${vector}`)
    })
  }

  test("keeps the reply's own vector, excluding a quoted earlier one", () => {
    const earlier = vector.replace("c79e24b18f603ad5e2a890764bd1f3c6", "b84d19a72e6f438da0c3f98516a72bce")
    const sign = vectorSign(`Цитата:\n\`\`\`yaml\n${earlier}\n\`\`\`\n\nРезультат текущего хода:\n${vector}`)
    expect(sign).toEndWith(`\n\n${vector}`)
    expect(sign).not.toContain("b84d19a72e6f438da0c3f98516a72bce")
  })

  test("does not invent missing chain fields", () => {
    const incomplete = vector.split("\n").slice(0, 3).join("\n")
    expect(vectorSign(incomplete)).toEndWith(`\n\n${incomplete}`)
    expect(vectorSign(incomplete)).not.toContain("prev-md5:")
    expect(vectorSign(incomplete)).not.toContain("parent-goal-md5:")
  })

  test("does not sign absent or malformed vectors", () => {
    expect(vectorSign(undefined)).toBeUndefined()
    expect(vectorSign("Обычный ответ без SV.")).toBeUndefined()
    expect(vectorSign(vector.replace("c79e24b18f603ad5e2a890764bd1f3c6", "invalid"))).toBeUndefined()
  })
})
