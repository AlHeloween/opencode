// Are split-chunk contents compressed inside the exe? Look for:
//  - 'chunk-' names (string table)
//  - zstd/gzip magic near chunk data
//  - known ASCII fragment from a tool prompt that IS split into chunks
const fs = require("fs")
const pkg = "D:/zPython/opencode/packages/opencode"
const bin = fs.readFileSync(pkg + "/dist/opencode-windows-x64/bin/opencode.exe").toString("latin1")
console.log("chunk names present:", bin.includes("chunk-"))
// zstd magic: 28 B5 2F FD ; gzip: 1F 8B
const zstdCount = (bin.match(/\x28\xb5\x2f\xfd/g) ?? []).length
const gzipCount = (bin.match(/\x1f\x8b\x08/g) ?? []).length
console.log("zstd magics:", zstdCount, "| gzip magics:", gzipCount)
// tool prompt content probes (these .txt are tool descriptions):
console.log("tool txt 'Use this tool when you need to ask':", bin.includes("Use this tool when you need to ask"))
console.log("tool txt ASCII '5 words, concise':", bin.includes("5 words, concise"))
