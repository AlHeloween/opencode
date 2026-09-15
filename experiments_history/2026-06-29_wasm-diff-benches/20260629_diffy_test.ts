const d = require("D:/zPython/opencode/packages/wasm/external/diffy-wasm/pkg/diffy_wasm.js")

console.log("=== create_patch ===")
const patch = d.diff_create_patch("a\nb\nc", "a\nx\nc")
console.log(patch)

console.log("\n=== apply ===")
const result = d.diff_apply("a\nb\nc", patch)
console.log(result)

console.log("\n=== stats ===")
console.log(d.diff_stats("a\nb\nc", "a\nx\nc"))

console.log("\n=== parse ===")
console.log(d.diff_parse(patch))

console.log("\n=== identical ===")
console.log(d.diff_create_patch("hello", "hello"))

console.log("\n=== empty ===")
console.log(d.diff_create_patch("", "new\nlines"))

console.log("\n=== patch apply error ===")
try {
  console.log(d.diff_apply("wrong", "bad patch text"))
} catch (e: any) {
  console.log("ERROR:", e.message)
}
