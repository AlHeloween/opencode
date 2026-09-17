/**
 * How far the undo/redo cursor can still move, in each direction.
 *
 * Undo, redo and revert-to-a-message are steps of ONE sequence (see
 * `RevertRedoFrame` in session/session.ts), so the TUI needs two counts to
 * offer arrows: how many more undos exist behind the cursor, and how many
 * redos ahead of it. Both are derived, not stored — keeping a stored counter
 * in sync with the fossil leaves is exactly the drift the sequence model was
 * built to avoid.
 */

export interface RevertStepsInput {
  /** Session messages in ascending id order, as the transcript holds them. */
  messages: readonly { readonly id: string; readonly role: string }[]
  revert?: { readonly messageID: string; readonly redo_stack?: readonly unknown[] } | null
}

export interface RevertSteps {
  /** Undos still available behind the cursor. */
  back: number
  /** Redos available ahead of the cursor. */
  forward: number
}

export function revertSteps(input: RevertStepsInput): RevertSteps {
  const users = input.messages.filter((message) => message.role === "user")

  // Mirrors the `session.undo` command: it targets the last user message
  // strictly before the cursor, so the remaining undos are the user messages
  // behind it. With no revert active the cursor sits past the end and every
  // user message is still reachable.
  const cursor = input.revert?.messageID
  const back = cursor ? users.filter((message) => message.id < cursor).length : users.length

  // `op_id` is the immediate forward leaf and each `redo_stack` frame is one
  // more beyond it, so an active revert always has at least one redo.
  const forward = input.revert ? 1 + (input.revert.redo_stack?.length ?? 0) : 0

  return { back, forward }
}
