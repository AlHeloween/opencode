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
