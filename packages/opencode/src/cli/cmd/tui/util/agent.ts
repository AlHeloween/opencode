/** Only primary/all agents may become the active prompt identity in the TUI. */
export function canActivateAgent(
  target: string | undefined,
  agents: ReadonlyArray<{ name: string; mode: string }>,
) {
  return target !== undefined && agents.some((agent) => agent.name === target && agent.mode !== "subagent")
}

/** Selecting a model for ANOTHER agent (the /agents path passes an explicit
 * target) configures that agent — it must never move the active prompt
 * identity. A picker opened without an explicit target may activate its
 * resolved primary agent (2026-09-11, Alexander: "она автоматом выбирается в основном окне"). */
export function shouldActivateAgent(
  target: string | undefined,
  explicitTarget: string | undefined,
  agents: ReadonlyArray<{ name: string; mode: string }>,
) {
  if (explicitTarget !== undefined) return false
  return canActivateAgent(target, agents)
}

/** Every pick that can hold the OPEN session's layer lands there too — worktree included, for ANY
 *  agent (owner spec, 2026-09-26: «Выбор из этого режима берётся из worktree»: choosing DeepSeek in
 *  the worktree tab must not leave the session on its previous model — «я выбрал deepseek в
 *  worktree, а стоит бигпикл»). The ACTIVE agent is not moved by the write; only the session's
 *  value for the picked agent changes. Global stays a config write. */
export function shouldUpdateSessionModelOnPick(
  scope: "session" | "worktree" | "global" | undefined,
  hasSession: boolean,
): boolean {
  return hasSession && scope !== "global"
}

/** Whether a pick MAY ALSO write the worktree layer beside the one it edits.
 *
 *  One direction only. The chain global → worktree → session is FILLED, never resolved, so a layer
 *  holds exactly one fact about one agent's model. A session pick that also rewrote
 *  `state/model.json` is what fused the worktree and session tabs of /agents into one control —
 *  owner, 2026-09-26: «после последнего фикса /agents worktree и /agents/ session стали
 *  связанными. Меняешь session меняется worktree» — and the same fusion sat in the variant writes.
 *
 *  `undefined` — a hotkey, `/model`, or the startup `--model` — means «a choice for THIS request»
 *  and writes both: the wire reads the session, the next session is filled from the worktree, and a
 *  choice made with no scope open has to reach both (owner, 2026-09-20). `global` is a config write
 *  and touches neither local layer.
 *
 *  The carry DOWN is the other half and is unchanged: a worktree pick still lands in an open
 *  session (`shouldUpdateSessionModelOnPick`, owner spec 2026-09-26 п.3). One direction, not zero.
 */
export function writesWorktreeOnPick(scope: "session" | "worktree" | "global" | undefined): boolean {
  return scope === "worktree" || scope === undefined
}

/** Which settings LAYER a model read resolves against, from the route alone.
 *
 *  The predicate is the ROUTE, never `activeSessionID`: on `home` that resolver returns the
 *  NEWEST session (`local.tsx:54-57`) for write bookkeeping, and reusing it for reads made the
 *  first screen answer with a NEIGHBOUR session's layer — measured live 2026-09-26 on 10.0.1124:
 *  the prompt read «Build · DeepSeek V4.1 Flash · max» while /agents (phase = worktree) showed
 *  «Big Pickle» on the same screen (owner's screenshot, verbatim: «Потому что мы дебилы»).
 *
 *  With no session OPEN the layer that governs is the worktree — exactly what a session created
 *  from here would be filled from — so the first screen and /agents name the same layer. The
 *  dialogs already use this predicate (`route.data.type === "session"`); a read must not spell it
 *  differently. */
export function readLayer(routeType: string): "session" | "worktree" {
  return routeType === "session" ? "session" : "worktree"
}
