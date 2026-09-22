/**
 * A reply continuation must not reach through a LIVE component prop.
 *
 * Defect (measured 2026-09-21 in the dist-plane log `1790005828925`): answering a question resolved,
 * the reply removed the request from the store, the dialog unmounted and `props.request` became
 * `undefined` — and the continuation read `.sessionID` off it. Control then fell into `.catch`, which
 * read the SAME dead object's `.id` and threw AGAIN. A throw inside the `.catch` of a `void`-ed
 * promise is an unhandled rejection, and `index.ts:48-53` answers one with `process.exit(1)`: the TUI
 * "cleanly exited" 19 ms after a `200`. The same shape sat in the permission prompt, which is answered
 * far more often.
 *
 * The fix is the capture of identity ONCE, before any await — so the pin counts the reads. An extra
 * reach-through anywhere in the body raises the count and fails, which is what makes this able to fail
 * on a regression rather than merely describing the current text.
 */
import { describe, expect, test } from "bun:test"
import fs from "fs"
import path from "path"

const TUI = path.join(import.meta.dir, "../../src/cli/cmd/tui/routes/session")

/**
 * Slice ONE function out of a component file.
 *
 * The end anchor is the NEXT DECLARATION in the file, never an indentation or brace pattern. Two probe
 * failures came from getting this wrong, both the instrument's and not the code's: these files are
 * CRLF, so a `\n  }\n` delimiter found nothing; and once EOLs were normalised the same brace pattern
 * still ran PAST the function into its neighbours and counted THEIR reads (4 where the function has 2).
 * A named next-declaration cannot drift with EOLs, indentation or a closing brace inside a callback.
 */
function bodyOf(file: string, signature: string, until: string): string {
  const source = fs.readFileSync(path.join(TUI, file), "utf8").replace(/\r\n/g, "\n")
  const start = source.indexOf(signature)
  if (start < 0) throw new Error(`the probe is BLIND, not the code: ${signature} is not in ${file}`)
  const end = source.indexOf(until, start)
  if (end < 0) throw new Error(`the probe cannot delimit ${signature} in ${file} — fix the instrument`)
  return source.slice(start, end)
}

const CASES = [
  {
    file: "question.tsx",
    signature: "function settle(",
    until: "function answerQuestion(",
    promise: "void promise",
  },
  {
    file: "permission.tsx",
    signature: "function respond(",
    until: "const input = createMemo(",
    promise: "void sdk.client.permission",
  },
]

describe("a reply continuation captures its identity before awaiting", () => {
  test("POSITIVE CONTROL — the probe finds the bodies it is asked for", () => {
    for (const one of CASES) {
      const body = bodyOf(one.file, one.signature, one.until)
      expect(body.length).toBeGreaterThan(200)
      expect(body).toContain(one.promise)
      expect(body).toContain(".catch(")
    }
  })

  for (const one of CASES) {
    test(`${one.file}: props.request is read exactly TWICE — the two captures, never in a continuation`, () => {
      const body = bodyOf(one.file, one.signature, one.until)
      expect(body).toContain("const requestID = props.request.id")
      expect(body).toContain("const sessionID = props.request.sessionID")
      // Count the CODE, not the prose. The doc comment above names `props.request` twice to explain the
      // defect, and a plain text match counted THOSE — the instrument reporting on its own words. A
      // full-line comment cannot inflate the count here; a reach-through in a `.then`/`.catch` adds a
      // third real read and still fails.
      const code = body
        .split("\n")
        .filter((line) => {
          const trimmed = line.trim()
          return !trimmed.startsWith("//") && !trimmed.startsWith("*") && !trimmed.startsWith("/*")
        })
        .join("\n")
      expect(code.match(/props\.request/g)?.length).toBe(2)
    })
  }
})
