# Surface standards — GUI, TUI, ergonomics, project shape

These four catalogues lived in the reasoning kernel's G1 (GROUND) block until 2026-09-24. They were
evicted for a measured reason, not for taste: G0+G1 is the section an agent must read and satisfy
BEFORE its first instrument call, it had grown to 7 309 B (×2.6 since 2026-09-16), and these four
entries — 1 624 B, a third of G1 — help build a surface but never help *find* one. An imperative
that is not a call can only be satisfied by prose, so their position was paying for narration
instead of grounding.

The kernel keeps one pointer at G7 (IMPLEMENT), where the standards are actually applied. Read this
file before building or reviewing a surface; cite the clause you build on.

## GUI

Design per Material Design 3 (web/Android), Apple HIG (iOS/macOS) or the project's UI kit; a11y per
WCAG 2.1+ (contrast, screen reader, semantic markup, 100 % keyboard); responsive and pixel-accurate
at the target resolutions and DPI; feedback states (loading/skeleton), no multi-submit, actionable
errors; never block the UI thread on I/O or compute.

Oracle: E2E for the critical flows (Playwright/Cypress) and visual regression for components
(Storybook/Percy) — kept in the kernel at G8 as `GUI_ORACLE`.

## TUI

Restore the terminal on exit AND on crash (raw mode off, cursor shown, alt screen cleared, colours
reset); redraw on resize (SIGWINCH) and survive tiny sizes; 100 % keyboard (arrows/hjkl, Tab focus,
Esc cancel, Ctrl+C interrupt; mouse optional); degrade TrueColor→256→16→mono and honour
`NO_COLOR=1`; event-driven, never poll; repaint only what changed (no flicker); verify on the target
emulators (xterm, Alacritty, Windows Terminal, iTerm2, tmux) with UTF-8, emoji and box-drawing.

## Ergonomics

ISO 9241 baseline; progressive disclosure over dense screens; Fitts (large, adjacent targets for
critical actions; ≥ 44×44 pt/dp for touch) and Hick (fewer options, faster decisions); type
ergonomics (50–75 chars per line, adequate leading, F/Z scan patterns); consistent placement and
standard shortcuts for muscle memory; poka-yoke error prevention, destructive actions confirmed,
Undo that keeps context.

## Project shape — grounded, not assumed

The root manifests live in the root; core = pure testable library, separate from UI (GUI/CLI) and
I/O (SoC); `src/` + `include/` layout; `README.md` names the modules; ONE canonical dependency file;
settings are strict validated models (formal configuration), the config utility lives in-repo.
