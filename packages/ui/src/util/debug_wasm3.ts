// Direct test of the init logic
const url = new URL("../../../wasm/core/pkg/diff.wasm", import.meta.url)
console.log("URL:", url.href)
console.log("pathname:", url.pathname)

try {
  const file = Bun.file(url)
  console.log("file size:", file.size)
  const bytes = await file.arrayBuffer()
  console.log("bytes:", bytes.byteLength)
  
  const mod = await WebAssembly.compile(bytes)
  console.log("compiled")
  
  const memory = new WebAssembly.Memory({ initial: 256, maximum: 512 })
  const strlen = (ptr: number): number => {
    const mem = new Uint8Array(memory.buffer)
    let len = 0
    while (mem[ptr + len] !== 0) len++
    return len
  }
  
  const instance = await WebAssembly.instantiate(mod, { env: { memory, strlen } })
  console.log("instantiated")
  
  const spGlobal = instance.exports.__stack_pointer as WebAssembly.Global
  console.log("initial SP:", spGlobal.value)
  spGlobal.value = 16 * 1024 * 1024
  console.log("SP set to:", spGlobal.value)
  
  const diff_compute = instance.exports.diff_compute as CallableFunction
  console.log("diff_compute:", typeof diff_compute)
  
  // Test
  const encoder = new TextEncoder()
  const mem = new Uint8Array(memory.buffer)
  const oldBytes = encoder.encode("a\nb")
  const newBytes = encoder.encode("a\nc\nb")
  mem.set(oldBytes, 0)
  mem.set(newBytes, 64)
  
  const outLen = diff_compute(0, oldBytes.length, 64, newBytes.length, 128, 1024)
  console.log("outLen:", outLen)
  const json = new TextDecoder().decode(mem.slice(128, 128 + outLen))
  console.log("JSON:", json)
  
} catch (e) {
  console.error("Error:", e)
}
