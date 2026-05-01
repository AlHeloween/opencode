import { describe, expect, test } from "bun:test"
import { MessageV2 } from "../../src/session/message-v2"
import { classifyText, formatSemanticVector } from "../../src/session/semantic-vector"

describe("MessageV2.search", () => {
  test("sanitizeFTSQuery: single word", () => {
    const sanitizeFTSQuery = (query: string) =>
      query
        .split(/\s+/)
        .map((w) => `"${w.replace(/"/g, '""')}"`)
        .join(" ")

    expect(sanitizeFTSQuery("hello")).toBe('"hello"')
  })

  test("sanitizeFTSQuery: multiple words", () => {
    const sanitizeFTSQuery = (query: string) =>
      query.split(/\s+/).map((w) => `"${w.replace(/"/g, '""')}"`).join(" ")
    expect(sanitizeFTSQuery("hello world")).toBe('"hello" "world"')
  })

  test("sanitizeFTSQuery: quotes escaped", () => {
    const sanitizeFTSQuery = (query: string) =>
      query.split(/\s+/).map((w) => `"${w.replace(/"/g, '""')}"`).join(" ")
    expect(sanitizeFTSQuery('say "hi"')).toBe('"say" """hi"""')
  })

  test("sanitizeFTSQuery: extra whitespace collapsed", () => {
    const sanitizeFTSQuery = (query: string) =>
      query.split(/\s+/).map((w) => `"${w.replace(/"/g, '""')}"`).join(" ")
    expect(sanitizeFTSQuery("hello   world")).toBe('"hello" "world"')
  })

  test("sanitizeFTSQuery: empty string", () => {
    const sanitizeFTSQuery = (query: string) =>
      query.split(/\s+/).map((w) => `"${w.replace(/"/g, '""')}"`).join(" ")
    expect(sanitizeFTSQuery("")).toBe('""')
  })
})

describe("MessageV2.highlightSnippet", () => {
  test("highlights matched word with bold markdown", () => {
    const text = "This is a test message about TypeScript interfaces"
    const result = MessageV2.highlightSnippet(text, "TypeScript")
    expect(result).toContain("**TypeScript**")
  })

  test("adds ellipsis when text exceeds maxLen", () => {
    const text = "a".repeat(300) + " database " + "b".repeat(300)
    const result = MessageV2.highlightSnippet(text, "database")
    expect(result).toContain("...")
  })

  test("highlights all query words", () => {
    const text = "TypeScript interfaces are great for type safety"
    const result = MessageV2.highlightSnippet(text, "TypeScript interfaces")
    expect(result).toContain("**TypeScript**")
    expect(result).toContain("**interfaces**")
  })

  test("case insensitive matching preserves original casing", () => {
    const text = "HELLO world"
    const result = MessageV2.highlightSnippet(text, "hello")
    expect(result).toContain("**HELLO**")
  })

  test("empty text returns empty string", () => {
    expect(MessageV2.highlightSnippet("", "query")).toBe("")
  })

  test("empty query returns first chars of text", () => {
    const text = "some text content here"
    const result = MessageV2.highlightSnippet(text, "")
    expect(result).toBe(text.slice(0, 200))
  })

  test("no match returns first 200 chars without highlighting", () => {
    const text = "no matching words here just plain text content throughout"
    const result = MessageV2.highlightSnippet(text, "xyznotfound")
    expect(result).not.toContain("**")
    expect(result).toBe(text.slice(0, 200))
  })
})

describe("semantic-vector.classifyText", () => {
  test("exact keywords produce high exactCoef", () => {
    const sv = classifyText("The function returns a const value and imports the module correctly")
    expect(sv.exactCoef).toBeGreaterThan(sv.inferredCoef)
    expect(sv.exactCoef).toBeGreaterThan(sv.hypotheticalCoef)
    expect(sv.exactCoef).toBeGreaterThan(sv.guessCoef)
  })

  test("inferred keywords produce high inferredCoef", () => {
    const sv = classifyText("The evidence suggests this pattern indicates a likely correlation based on the data")
    expect(sv.inferredCoef).toBeGreaterThan(sv.exactCoef)
    expect(sv.inferredCoef).toBeGreaterThan(sv.hypotheticalCoef)
  })

  test("hypothetical keywords produce high hypotheticalCoef", () => {
    const sv = classifyText("If we suppose this might be a theoretical scenario, it would be potentially useful")
    expect(sv.hypotheticalCoef).toBeGreaterThan(sv.exactCoef)
    expect(sv.hypotheticalCoef).toBeGreaterThan(sv.inferredCoef)
  })

  test("guess keywords produce high guessCoef", () => {
    const sv = classifyText("Maybe perhaps I guess we are unsure and could try to experiment and see if it works")
    expect(sv.guessCoef).toBeGreaterThan(sv.exactCoef)
    expect(sv.guessCoef).toBeGreaterThan(sv.inferredCoef)
  })

  test("unknown keywords produce high unknownCoef", () => {
    const sv = classifyText("The value is unknown and missing, this is unclear and incomplete with a null field")
    expect(sv.unknownCoef).toBeGreaterThan(sv.exactCoef)
    expect(sv.unknownCoef).toBeGreaterThan(sv.inferredCoef)
  })

  test("coefficients sum to 10", () => {
    const testCases = [
      "The function returns a const",
      "It seems likely based on evidence",
      "If we suppose it might be",
      "Maybe I guess we are unsure",
      "The value is unknown and missing",
      "Just regular text here",
    ]
    for (const text of testCases) {
      const sv = classifyText(text)
      expect(sv.exactCoef + sv.inferredCoef + sv.hypotheticalCoef + sv.guessCoef + sv.unknownCoef).toBe(10)
    }
  })

  test("default distribution when no keywords match", () => {
    const sv = classifyText("Just regular text here with no special keywords at all")
    expect(sv.exactCoef).toBe(10)
    expect(sv.inferredCoef).toBe(0)
    expect(sv.hypotheticalCoef).toBe(0)
    expect(sv.guessCoef).toBe(0)
    expect(sv.unknownCoef).toBe(0)
  })

  test("topic detection database", () => {
    const sv = classifyText("The SQL query joins the table and column with a proper schema migration and index")
    expect(sv.dominant).toBe("database")
  })

  test("topic detection typescript", () => {
    const sv = classifyText("The TypeScript interface uses generics and type inference for better type safety")
    expect(sv.dominant).toBe("typescript")
  })

  test("topic detection search", () => {
    const sv = classifyText("The FTS5 full-text search uses BM25 ranking for query relevance matching")
    expect(sv.dominant).toBe("search")
  })

  test("topic detection git", () => {
    const sv = classifyText("The git commit was merged into the main branch after a rebase and diff review")
    expect(sv.dominant).toBe("git")
  })

  test("keywords have normalized scores between 0 and 1", () => {
    const sv = classifyText("The SQL query joins the table with proper schema and index design")
    for (const kw of sv.keywords) {
      expect(kw.score).toBeGreaterThanOrEqual(0)
      expect(kw.score).toBeLessThanOrEqual(1)
    }
  })

  test("keywords sorted descending by score", () => {
    const sv = classifyText("The SQL query joins the table with proper schema and index design")
    for (let i = 1; i < sv.keywords.length; i++) {
      expect(sv.keywords[i].score).toBeLessThanOrEqual(sv.keywords[i - 1].score)
    }
  })

  test("dominant topic is highest scoring topic", () => {
    const sv = classifyText("The SQL query joins the table with proper schema and index design")
    if (sv.keywords.length > 0) {
      expect(sv.keywords[0].word).toBe(sv.dominant)
    }
  })
})

describe("semantic-vector.formatSemanticVector", () => {
  test("formats as word score pairs", () => {
    const sv = classifyText("The SQL query joins the table with proper schema and index design")
    const formatted = formatSemanticVector(sv)
    expect(formatted).toMatch(/\w+\(\d+\.\d{2}\)/)
  })

  test("contains dominant topic first", () => {
    const sv = classifyText("The SQL query joins the table with proper schema and index design")
    const formatted = formatSemanticVector(sv)
    expect(formatted).toMatch(new RegExp(`^${sv.dominant}\\(`))
  })
})
