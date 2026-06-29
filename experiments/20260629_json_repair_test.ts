const jr = require("D:/zPython/opencode/packages/wasm/external/json-repair/json-repair/pkg/json_repair.js")

const cases: [string, boolean][] = [
  ['{"a": 1,}', true],          // trailing comma
  ['{"a": [1, 2}', true],        // missing bracket
  ['{a: 1}', true],              // unquoted keys
  ['{"msg": "unterminated', true], // unterminated string
  ['{"x": 1, "y": 2}', true],    // valid
  ['[1,2,3,]', true],            // trailing comma in array
  ['{"a": 1\n"b": 2}', true],    // missing comma
  ['{"key": \'value\'}', true],  // single quotes
  ['{"a": tru}', true],          // truncated boolean
  ['{true: false}', true],       // unquoted boolean key
]

let ok = 0, fail = 0
for (const [input, expect] of cases) {
  const r = jr.json_repair(input)
  if (!r) {
    console.log(`FAIL (no output): ${input}`)
    fail++
    continue
  }
  try {
    const parsed = JSON.parse(r)
    console.log(`OK: ${input.slice(0,35).padEnd(35)} -> ${JSON.stringify(parsed).slice(0, 60)}`)
    ok++
  } catch {
    console.log(`FAIL (invalid): ${input.slice(0,35).padEnd(35)} -> ${r.slice(0, 60)}`)
    fail++
  }
}
console.log(`\n${ok} pass, ${fail} fail`)
