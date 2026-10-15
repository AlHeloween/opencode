import { describe, expect, test } from "bun:test"
import { docReadBlock, docReadDisabled } from "../../src/session/doc-read"

describe("session.doc-read", () => {
  test("a python read_text over a doc is refused with the route", () => {
    const hit = docReadBlock(`python -c "from pathlib import Path; print(Path('_progress_log.md').read_text()[-2000:])"`)
    expect(hit).toBeDefined()
    expect(hit!).toMatch(/scan, not reading/)
  })

  test("python open() in text mode over a doc is refused", () => {
    expect(docReadBlock(`python -c "print(open('README.md').read()[:500])"`)).toBeDefined()
  })

  test("node readFileSync with utf8 over a doc is refused", () => {
    expect(
      docReadBlock(`node -e "const fs=require('fs');console.log(fs.readFileSync('doc.md','utf8').split('\\n').length)"`),
    ).toBeDefined()
  })

  test("a byte check passes — read_bytes stays allowed (control)", () => {
    expect(docReadBlock(`python -c "print(Path('x.md').read_bytes()[:4])"`)).toBeUndefined()
  })

  test("'rb' mode passes — byte-level checks stay allowed (control)", () => {
    expect(docReadBlock(`python -c "print(open('x.md','rb').read(4))"`)).toBeUndefined()
  })

  test("readFileSync without an encoding passes — that is bytes, not text (control)", () => {
    expect(docReadBlock(`node -e "fs.readFileSync('x.md')"`)).toBeUndefined()
  })

  test("a doc WRITE passes — writes are another rule's business (control)", () => {
    expect(docReadBlock(`python -c "open('x.md','w').write('t')"`)).toBeUndefined()
    expect(docReadBlock(`python -c "Path('x.md').write_text('t')"`)).toBeUndefined()
  })

  test("no read API passes — a mention is not a read", () => {
    expect(docReadBlock(`python -c "print('see README.md for usage')"`)).toBeUndefined()
  })

  test("no interpreter passes — the gate is about scripts, not grep (control)", () => {
    expect(docReadBlock(`grep pattern README.md`)).toBeUndefined()
  })

  test("no doc extension passes — json is not a doc", () => {
    expect(docReadBlock(`python -c "json.load(open('config.json'))"`)).toBeUndefined()
  })

  test("opt-out env disables the gate", () => {
    expect(docReadBlock(`python -c "Path('x.md').read_text()"`, { OPENCODE_DOC_READ_GATE: "0" })).toBeUndefined()
  })

  test("docReadDisabled spellings follow the repo convention", () => {
    for (const v of ["0", "false", "off", "no"]) expect(docReadDisabled({ OPENCODE_DOC_READ_GATE: v })).toBe(true)
    expect(docReadDisabled({})).toBe(false)
    expect(docReadDisabled({ OPENCODE_DOC_READ_GATE: "1" })).toBe(false)
  })
})
