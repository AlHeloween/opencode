/**
 * ONE automatic bound on a tool result, in ONE home (owner, 2026-10-13: «16384 строк или 256кб
 * ограничение, свернет если надо»).
 *
 * Before this file there were three answers to "how big may a result be", each in its own place and
 * each with its own number: `read` capped itself at 2 000 lines / 50 KB, the replay rendering folded
 * anything over 8 000 chars into a placeholder, and `recall` cut its own answers at 32 000 chars. The
 * effect on the caller was the opposite of the intent — a robot that could only ever SEE 8 000 chars
 * learned to read in small windows, paying a round trip and a cache miss per window (measured
 * 2026-10-13: 1 623 of 5 605 `read` calls belonged to files opened in ≥4 offset windows, down to
 * 10-16 lines at a time; 436 of 1 355 `recall` answers were released again by the size gate).
 *
 * The rule now: a result UNDER BOTH bounds is never released or folded — the robot keeps what it
 * asked for and releases it itself (`recall … keep`) or by a declared span (`ttl_until`). ABOVE
 * EITHER bound it folds into the existing ID-addressed placeholder, and `recall` answers in windows
 * that each stay inside the same pair.
 *
 * Both numbers are the owner's, not tuned here. 16 384 lines is a whole Delphi unit; 256 KB is its
 * text. A reader who wants either changed changes them HERE — a second copy of the pair anywhere is
 * the defect this file exists to prevent.
 */
export const RESULT_LIMIT_LINES = 16_384
export const RESULT_LIMIT_CHARS = 256 * 1024

/**
 * TRUE when a result is over EITHER bound. Chars first: it is O(1), so the line scan runs only on a
 * string that could still be under the char bound. The scan counts newlines instead of splitting,
 * because this predicate runs for every tool part of every request and a result may be megabytes.
 */
export function overResultLimit(text: string): boolean {
  if (text.length > RESULT_LIMIT_CHARS) return true
  let lines = 1
  for (let at = text.indexOf("\n"); at !== -1; at = text.indexOf("\n", at + 1)) lines += 1
  return lines > RESULT_LIMIT_LINES
}
