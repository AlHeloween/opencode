<!-- intention: the shared Chrome debugging instance remains implicit background infrastructure -> explicit user requests can make the existing 9222 Chrome visible and use it for web debugging, click simulation, and screenshots -->
---
title: Visible Chrome debug workflow for agent requests
status: COMPLETED
owner: OpenCode team
reproduce:
  files:
    - prompt_kernel/addons.py
    - prompt_kernel/tests/test_addons.py
    - docs/tools-and-sidecars.md
  commands:
    - python -m pytest prompt_kernel/tests/ -q
    - python -m prompt_kernel --install
  inputs: user explicitly requests visible web debugging, click simulation, or screenshots
  expected_outputs: the OpenCode runtime explicitly routes the existing 127.0.0.1:9222 Chrome through exact CUA/CDP binding and permits visibility only for that requested workflow.
---

# Visible Chrome debug workflow for agent requests

## Goal
Make the existing Chrome remote-debugging endpoint at `127.0.0.1:9222` an explicit agent capability only when the user requests visible web debugging, click simulation, or screenshots. Preserve its normal background role for universal search and never restart, replace, or silently surface it.

## Grounded facts
- `universalsearch` itself talks to a local service and has no browser-control API; the host's Chrome debugging endpoint is operational infrastructure outside its TypeScript wrapper.
- CUA's browser flow binds an exact native `(pid, window_id)` before page actions. Existing-profile CDP access is sensitive and must remain user-authorized.
- CUA's `bring_to_front` is the explicit user-visible window control; browser click/type/screenshot actions have typed CUA/CDP routes. The existing `TOOL_ORACLE` rule already directs web visual claims to CUA.
- Prompt content is generated: modify `prompt_kernel/addons.py`, test its rendered G1 block, then render and install via `python -m prompt_kernel --install`.

## Tasks
| ID | Task | Binding | Oracle |
| --- | --- | --- | --- |
| B1 | [x] Add conditional visible-debug instruction | `prompt_kernel/addons.py` G1 `TOOL_GROUNDING` | rendered G1 assertion |
| B2 | [x] Preserve user authorization and existing-process constraints | `prompt_kernel/addons.py` | assertion for port, CUA binding, and no relaunch |
| B3 | [x] Render and install production OpenCode prompt | `prompt_kernel`, generated receiver | 100 passing kernel tests + install digest |
| B4 | [x] Document the Chrome debug contract | `docs/tools-and-sidecars.md`, `_progress_log.md` | read-back |

## Claims and risks
- C1: explicit visible-debug requests make the agent aware of the exact Chrome 9222 workflow. Falsifier: rendered OpenCode prompt omits the port, CUA/CDP route, or requested visibility condition.
- R1: existing-profile CDP access is sensitive. Containment: only use the existing endpoint after the user requested the visible workflow; bind the exact native window and do not launch/restart Chrome or alter its debugging flags.
- R2: foregrounding Chrome changes user-visible focus. Containment: only call CUA visibility/fronting control when the user's request explicitly asks for it; otherwise leave universal-search Chrome backgrounded.

## Smoke contract
- Baseline: rendered runtime directs web visual claims to CUA but does not name the shared 9222 Chrome or the user-requested visible workflow.
- Post-change: focused renderer test, full prompt-kernel suite, and production install all pass.

## Rollback
Remove the G1 add-on line and regenerated production prompt; no Chrome process, profile, or endpoint configuration is mutated by the rule change.
