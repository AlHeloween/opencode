/**
 * What each command in the Ctrl+P palette DOES — one line, shown under the list
 * and recomputed as the cursor moves.
 *
 * This table is the ONE place a palette command is explained in prose, and every
 * line is written after reading that command's registration and its handler. It is
 * deliberately NOT the keybind descriptions reused: those are phrased for a keybind
 * list, they are terse, and they do not exist at all for a command without a keybind
 * (Alexander, 2026-09-20: «для каждой команды хинт … не копипастить, а написать
 * свою таблицу хинтов проверив кодовую базу»).
 *
 * The key is the command's `value` — the same id `useCommandDialog().trigger()`
 * takes. So a command renamed in the registry shows up here as a MISSING hint (a
 * visible gap) rather than as a wrong explanation. A command with no entry falls
 * back to the `description` its own registration authored; adding a line here is
 * how a command gets a hint.
 */
export const COMMAND_HINTS: Record<string, string> = {
  // ── Session ────────────────────────────────────────────────────────────────
  "session.list": "List every session of this project and jump to one.",
  "session.new": "Start a fresh session; the current one stays in the list.",
  "session.share": "Publish this session and copy its link — or copy the link if it is already shared.",
  "session.rename": "Give this session a new title.",
  "session.restore": "Restore a file this session changed, from the copy taken before the edit.",
  "session.timeline": "Jump the transcript to a chosen message.",
  "session.fork": "Branch a new session off a chosen message, keeping the history up to it.",
  "session.compact": "Summarise this session and fold its window, so later turns stay inside the context.",
  "session.composite": "Show every session's messages in one transcript instead of only this session's.",
  "session.cleanup": "Delete this session's finished child (subagent) sessions.",
  "session.unshare": "Stop publishing this session; its link stops working.",
  "session.stop": "Abort the work currently running in this session.",
  "session.undo": "Take back the last message: revert its work, and put its text and files back in the prompt.",
  "session.redo": "Restore what the last undo removed.",
  "session.sidebar.toggle": "Show or hide the sidebar.",
  "session.toggle.conceal": "Hide or reveal the markdown syntax markers in the transcript.",
  "session.toggle.timestamps": "Show or hide the timestamp on each message.",
  "session.toggle.thinking": "Show or hide the model's thinking blocks.",
  "session.toggle.actions": "Show or hide the details of tool calls.",
  "session.toggle.scrollbar": "Show or hide the transcript scrollbar.",
  "session.toggle.generic_tool_output": "Show or hide output from tools that have no renderer of their own.",
  "session.jump.live": "Scroll back to the newest end of the transcript, following the live stream.",
  "messages.copy": "Copy the last assistant answer to the clipboard.",
  "session.copy": "Copy the whole transcript, as markdown, to the clipboard.",
  "session.export": "Write the transcript to a markdown file and open it in your editor.",

  // ── Agent / Provider ──────────────────────────────────────────────────────
  "agent.list": "Pick the agent that drives this session, and configure its model, variant and scope.",
  "mcp.list": "Turn MCP servers on or off.",
  "rules.list": "Turn rules files on or off.",
  "skills.list": "Turn skills on or off.",
  "tools.list": "Turn individual tools on or off.",
  "settings.dialog": "Open settings; every write goes to the layer (session / worktree / global) you pick.",
  "pipeline.run": "Run a named chain of agents — a pipeline — against the current prompt.",
  "agi.toggle": "Toggle autonomous (AGI) orchestration for this session.",
  "variant.cycle": "Step to the next model variant — for example a different thinking effort.",
  "variant.list": "Pick a model variant from a list.",
  "provider.connect": "Add a provider, or sign in to one you have already configured.",
  "console.org.switch": "Switch the active Console organisation — the scope usage and billing are reported against.",

  // ── Prompt ────────────────────────────────────────────────────────────────
  "prompt.editor": "Open the current prompt in your external editor; saving returns it to the input.",
  "prompt.skills": "Pick a skill and insert its /command into the prompt.",
  "prompt.stash": "Stash the prompt — text and attachments — and clear the input.",
  "prompt.stash.pop": "Put the most recently stashed prompt back into the input.",
  "prompt.stash.list": "Browse the stashed prompts and restore one.",

  // ── System ────────────────────────────────────────────────────────────────
  "opencode.status": "Show version, model, MCP/LSP connections and background jobs at a glance.",
  "navigation.settings": "Review and edit the permission rules.",
  "config.edit": "Open config.json in your default editor.",
  "theme.switch": "Pick a colour theme.",
  "theme.switch_mode": "Switch between light and dark mode.",
  "theme.mode.lock": "Lock the light/dark mode, so the theme cannot change it.",
  "tui.settings": "Edit TUI-only settings — appearance and keybinds.",
  "help.show": "Show the keybind and usage help.",
  "docs.open": "Open the documentation site in your browser.",
  "app.exit": "Quit opencode.",
  "app.debug": "Show or hide the renderer's debug overlay.",
  "app.console": "Show or hide the renderer console — logs and errors from the interface itself.",
  "app.heap_snapshot": "Write a heap snapshot file, for diagnosing memory growth.",
  "terminal.title.toggle": "Turn automatic terminal-title updates on or off.",
  "app.toggle.animations": "Turn interface animations on or off.",
  "app.toggle.file_context": "Turn the file-context section of the prompt on or off.",
  "app.toggle.diffwrap": "Turn word-wrapping of diffs on or off.",
  "plugins.list": "Open the plugin manager: which plugins are loaded, and their state.",
  "plugins.install": "Install a plugin from a package spec.",
  "tips.toggle": "Show or hide the tips on the home screen.",
}
