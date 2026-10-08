/**
 * The /mcps row description: the SERVER's own status word, plus the key that acts on it.
 *
 * Why a module instead of an inline ternary (same reason variant-dialog-state exists): the
 * mapping is what a user reads to learn WHAT to do next — `needs_auth` means «press ctrl+a» —
 * and the three exact spellings (`needs_auth`, `needs_client_registration`, `failed`) must not
 * drift between the dialog and its test.
 *
 * Must never throw: it runs inside a `createMemo` during render, and an unhandled throw there
 * takes the whole TUI down. An unknown status therefore degrades to its own string, not a crash.
 */
export function describeMcpStatus(status: { status: string; error?: string }): string {
  if (status.status === "failed") return `failed: ${status.error ?? "unknown error"}`
  if (status.status === "needs_auth") return "needs authentication — ctrl+a"
  if (status.status === "needs_client_registration") return "needs client registration — ctrl+a"
  return status.status
}
