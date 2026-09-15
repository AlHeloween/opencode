// Minimal repro: spawn the fiasco binary from Bun.
import path from "path"
const FIASCO = path.resolve("experiments/2026-09-08_fiasco-target/release/fractal-encode.exe")
console.log("resolved:", FIASCO, "exists:", await Bun.file(FIASCO).exists())
const proc = Bun.spawn([FIASCO, "--help"], { stdout: "pipe", stderr: "pipe", stdin: "ignore" })
const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
console.log("code:", code)
console.log("out:", out.slice(0, 200))
console.log("err:", err.slice(0, 200))
