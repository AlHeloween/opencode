/**
 * Thin pointer — real runner lives under packages/opencode (import aliases).
 *
 * Prefer:
 *   pwsh experiments/2026-08-06_fossil-undo-smoke/run.ps1
 *   cd packages/opencode && bun script/fossil-undo-smoke.ts
 */
console.error("Use: pwsh experiments/2026-08-06_fossil-undo-smoke/run.ps1")
console.error("  or: cd packages/opencode && bun script/fossil-undo-smoke.ts")
process.exit(2)
