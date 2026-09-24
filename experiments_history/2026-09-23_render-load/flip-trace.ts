// Trace for T11b step 2: at which deltas does the first list line lose the stored-parse colour?
// Prints, for each such delta, the block count and block 0's raw length/ends before and after.
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { mkdir } from "node:fs/promises"
import { MarkdownRenderable } from "../../packages/opentui/packages/core/src/renderables/Markdown.ts"
import { SyntaxStyle } from "../../packages/opentui/packages/core/src/syntax-style.ts"
import { RGBA } from "../../packages/opentui/packages/core/src/lib/RGBA.ts"
import { TreeSitterClient } from "../../packages/opentui/packages/core/src/lib/tree-sitter/index.ts"
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
const setup = await createTestRenderer({ width: 60, height: 40 })
const style = SyntaxStyle.fromStyles({
  default: { fg: RGBA.fromValues(0.85, 0.85, 0.85, 1) },
  "markup.list": { fg: RGBA.fromValues(0.4, 0.8, 1, 1) },
})
const md = new MarkdownRenderable(setup.renderer, { treeSitterClient, syntaxStyle: style, streaming: true })
setup.renderer.root.add(md)

type State = { tokenRaw: string; renderable: { constructor: { name: string } } }
const blocks = () => (md as unknown as { _blockStates: State[] })._blockStates
const describe = () =>
  blocks()
    .map((s, i) => `#${i}:${s.renderable.constructor.name}:${s.tokenRaw.length}:${JSON.stringify(s.tokenRaw.slice(-6))}`)
    .join(" ")
const markerColour = () => {
  const line = setup.captureSpans().lines.find((l) => l.spans.map((s) => s.text).join("").startsWith("1. \"Сознай"))
  if (!line) return "absent"
  const first = line.spans[0]!
  return first.text === "1. " ? "styled" : "plain"
}

let content = ""
let styledSeen = false
for (let i = 0; i < fixture.deltas.length; i++) {
  const before = describe()
  content += fixture.deltas[i]
  md.content = content
  await setup.renderOnce()
  const now = markerColour()
  if (now === "styled") styledSeen = true
  if (styledSeen && now === "plain") console.log(`delta ${i}: PLAIN after delta\n  before ${before}\n  after  ${describe()}`)
  await new Promise((resolve) => setTimeout(resolve, 25))
  await setup.renderOnce()
}
setup.renderer.destroy()
await treeSitterClient.destroy()
process.exit(0)
