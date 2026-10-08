/**
 * The `edit` renderer's view of one tool part's input — split out of `index.tsx`
 * so the shapes a model can emit can be exercised without mounting the TUI
 * (same reason as `text-segments.ts` and `deferred-mount.ts`).
 *
 * `state.input` is the model's RAW call: the processor writes the parsed
 * arguments into the part BEFORE any schema decode, so every field here is
 * untrusted until the tool itself rejects it. A throw here is a FATAL TUI error
 * (`error-component`), not a tool failure: crash report 2026-10-08 (opencode
 * 10.0.1222) was `(H.input.files ?? []).map is not a function` — a model-emitted
 * `files` that was not an array took the whole TUI down. So malformed input
 * degrades to an empty summary; this function never throws.
 */
type RawFile = { filePath?: string; edits?: ReadonlyArray<unknown> }

export function editInputSummary(
  input: { files?: unknown },
  filediffs: ReadonlyArray<{ file: string }>,
): { names: string[]; changes: number } {
  const files: ReadonlyArray<RawFile | null> = Array.isArray(input.files) ? (input.files as ReadonlyArray<RawFile | null>) : []
  const names = filediffs.length > 0 ? filediffs.map((fd) => fd.file) : files.map((f) => f?.filePath ?? "")
  const changes = files.reduce((n, f) => n + (f?.edits?.length ?? 1), 0)
  return { names, changes }
}
