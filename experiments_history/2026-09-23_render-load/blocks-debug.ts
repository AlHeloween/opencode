// Debug reader for T11b step 2: after streaming the fixture, print each block's raw tail, the
// closedAtBreak flag and the marginBottom the renderable actually carries. Reading state, not adding logs.
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { mkdir } from "node:fs/promises"
import { TreeSitterClient } from "../../packages/opentui/packages/core/src/lib/tree-sitter/index.ts"
import { MarkdownRenderable } from "../../packages/opentui/packages/core/src/renderables/Markdown.ts"
import { SyntaxStyle } from "../../packages/opentui/packages/core/src/syntax-style.ts"
import { createTestRenderer } from "../../packages/opentui/packages/core/src/testing/test-renderer.ts"

const fixture = JSON.parse(
  readFileSync(
    join(import.meta.dir, "../../packages/opentui/packages/core/src/renderables/__tests__/fixtures/reasoning-stream.json"),
    "utf8",
  ),
) as { deltas: string[] }

const dataPath = join(tmpdir(), "tree-sitter-markdown-renderable-test-data")
await mkdir(dataPath, { recursive: true })
const treeSitterClient = new TreeSitterClient({ dataPath })
await treeSitterClient.initialize()
const setup = await createTestRenderer({ width: 100, height: 200 })
const md = new MarkdownRenderable(setup.renderer, { treeSitterClient, syntaxStyle: SyntaxStyle.create(), streaming: true })
setup.renderer.root.add(md)
let content = ""
for (const delta of fixture.deltas) {
  content += delta
  md.content = content
  await setup.renderOnce()
}
for (let i = 0; i < 40; i++) {
  await setup.renderOnce()
  await new Promise((resolve) => setTimeout(resolve, 15))
}
const frameLines = setup.captureCharFrame().split("\n")
frameLines.forEach((line, i) => {
  if (/ask\/act\)|Plan for this turn|junk file\.|do both now/.test(line) || (i > 0 && /ask\/act\)|junk file\./.test(frameLines[i - 1]!)))
    console.log(`frame[${i}] ${JSON.stringify(line.trimEnd().slice(0, 60))}`)
})
await setup.renderOnce()
const states = (md as unknown as { _blockStates: Array<{ token: { type: string; raw: string; closedAtBreak?: boolean }; tokenRaw: string; renderable: { marginBottom: unknown; y: number; height: number; lineCount?: number; constructor: { name: string } } }> })._blockStates
states.forEach((s, i) => console.log(`geom[${i}] y=${s.renderable.y} height=${s.renderable.height} lines=${s.renderable.lineCount}`))
const parse = (md as unknown as { _parseState: { tokens: Array<{ type: string; raw: string }>; stableTokenCount?: number } })._parseState
console.log(`tokens=${parse.tokens.length} stable=${parse.stableTokenCount}`)
parse.tokens.forEach((t, i) => console.log(`  token[${i}] ${t.type} tail=${JSON.stringify(t.raw.slice(-12))}`))
states.forEach((s, i) =>
  console.log(
    `block[${i}] ${s.token.type} ${s.renderable.constructor.name} closedAtBreak=${s.token.closedAtBreak} margin=${String(s.renderable.marginBottom)} tail=${JSON.stringify(s.tokenRaw.slice(-12))}`,
  ),
)
md.destroy()
const shot = new MarkdownRenderable(setup.renderer, { treeSitterClient, syntaxStyle: SyntaxStyle.create(), streaming: true, content })
setup.renderer.root.add(shot)
for (let i = 0; i < 40; i++) {
  await setup.renderOnce()
  await new Promise((resolve) => setTimeout(resolve, 15))
}
const shotLines = setup.captureCharFrame().split("\n")
shotLines.forEach((line, i) => {
  if (/ask\/act\)|Plan for this turn|junk file\.|do both now/.test(line) || (i > 0 && /ask\/act\)|junk file\./.test(shotLines[i - 1]!)))
    console.log(`shot[${i}] ${JSON.stringify(line.trimEnd().slice(0, 60))}`)
})
const shotStates = (shot as unknown as { _blockStates: Array<{ token: { closedAtBreak?: boolean }; tokenRaw: string; renderable: { y: number; height: number } }> })._blockStates
shotStates.forEach((s, i) => console.log(`shotblock[${i}] y=${s.renderable.y} h=${s.renderable.height} closedAtBreak=${s.token.closedAtBreak} tail=${JSON.stringify(s.tokenRaw.slice(-12))}`))
setup.renderer.destroy()
await treeSitterClient.destroy()
process.exit(0)
