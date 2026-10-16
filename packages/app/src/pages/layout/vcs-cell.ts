/**
 * Pure VCS indicator computation for the web sidebar (t59 W3).
 *
 * The TUI detects the backend from the worktree filesystem
 * (`jj → fossil → git`, `util/vcs-indicator.ts:42-47`). The browser cannot
 * walk the server's filesystem; its reachable sources are the synced project
 * record (`project.vcs`) and the per-directory VCS info (`sync.data.vcs` —
 * branch and default branch via `GET /vcs`). Whatever is missing reads
 * `unknown` — never blank.
 *
 * Residual, stated plainly: the fossil-sidecar half of the tri-state has no
 * web-reachable source (detection is fs-local to the server process). It
 * needs a small server route; it is NOT approximated here.
 */

export function describeVcs(input: { backend?: string | undefined; branch?: string | undefined }): { label: string } {
  const backend = input.backend && input.backend.length > 0 ? input.backend : undefined
  const branch = input.branch && input.branch.length > 0 ? input.branch : undefined
  if (backend && branch) return { label: `${backend} · ${branch}` }
  if (backend) return { label: backend }
  if (branch) return { label: branch }
  return { label: "unknown" }
}
