# Symbol map read-back: 0/4 correct

- map: 132 files, 3060 symbols, 7797 edges
- chars 253469 -> ~76117 tokens as text
- rendered 20 pages (990950 B) -> 19260 tokens as images
- ratio: **3.95x cheaper as images**

## file list

**FAIL** (tokens=19293)

```
Here is the list of every file covered in the provided symbol map, as named:

session-context-breakdown.test.ts
session-context-breakdown.ts
session-context-format.ts
session-context-metrics.test.ts
session-context-metrics.ts
session-context-tab.test.ts
session-context-tab.tsx
session-header.test.tsx
session-header.tsx
session-layout.tsx
session-model-helpers.test.ts
session-model-helpers.ts
session-panel.tsx
session-side-panel.tsx
session-terminal-panel.test.ts
session-terminal-panel.tsx
session-title.ts
session.ts
session-bus.ts
session-compaction.test.ts
session-compaction.ts
session-compaction-utils.ts
session-context-usage.ts
session-followup-dock.tsx
session-followup-dock.test.tsx
session-permission-dock.tsx
session-permission-dock.test.tsx
session-question-dock.tsx
session-question-dock.test.tsx
session-revert-dock.tsx
session-revert-dock.test.tsx
session-todo-dock.tsx
session-todo-dock.test.tsx
session-composer-region.tsx
session-composer-region.test.tsx
session-composer-state.ts
session-composer-state.test.ts
session-footer.tsx
session-provider-transform.ts
session-provider-transform.test.ts
session-provider.test.ts
session-provider.ts
session-revert-state.ts
session-revert-state.test.ts
session-run-state.ts
session-run-state.test.ts
session-settings.test.ts
session-settings.ts
session-settings-routing.test.ts
session-settings-session-tools.test.ts
session-settings-subagents.test.ts
session-settings-subagents.test.ts
session-settings-undo-fossil.test.ts
session-settings-undo-fossil.test.ts
session-sidecar-policy.test.ts
session-sidecar-policy.ts
session-step-undo.test.ts
session-summary-cadence.test.ts
session-summary-cadence.ts
session-system-compose.test.ts
session-system-compose.ts
session-title.ts
session-token-calibration.test.ts
session-token-calibration.ts
session-tool-repair-policy.test.ts
session-tool-repair-policy.ts
session-tool-repair-policy.ts
session-tool-repair.test.ts
session-tool-repair.ts
session-v2-entry-stepper.test.ts
session-v2-entry-stepper.ts
session-v2.test.ts
session-v2.ts
sidebar.test.tsx
sidebar.tsx
sidebar-footer.tsx
sidebar-item.tsx
sidebar-session.tsx
skill.ts
snapshot-cleanup.test.ts
snapshot-cleanup.ts
snapshot-fossil.test.ts
snapshot-fossil.ts
snapshot-tool-race.test.ts
snapshot.test.ts
snapshot.ts
solid-primitives-event-listener.tsx
solid-primitives-resize-observer.tsx
status-popover.test.tsx
status-popover.tsx
storage.test.ts
storage.ts
structured-output-integration.test.ts
structured-output.test.ts
structured-output.ts
subagent-data.ts
subagent-data.test.ts
subagent.test.ts
subagent.ts
summary-cadence.test.ts
summary-cadence.test.ts
summary-sidecar.test.ts
summary-sidecar.test.ts
summary.test.ts
summary.ts
system-compose.test.ts
system-compose.ts
system-prompt-anthropic.test.ts
system-prompt-anthropic.txt
system-prompt-copilot-gpt-5.txt
system-prompt-copilot-gpt-5.txt
system-prompt-default.txt
system-prompt-default.txt
system-prompt-gemini.txt
system-prompt-gemini.txt
system-prompt-gpt.txt
system-prompt-gpt.txt
system-prompt-kimi.txt
system-prompt-kimi.txt
system-prompt-trinity.txt
system-prompt-trinity.txt
system-prompt.beast.txt
system-prompt.beast.txt
system-prompt.default.txt
system-prompt.default.txt
system-prompt.gemini.txt
system-prompt.gemini.txt
system-prompt.txt
system-prompt.txt
system.ts
terminal-panel.test.tsx
terminal-panel.tsx
theme.ts
todos.test.ts
todos.ts
token-calibration.test.ts
token-calibration.ts
tool-registry.test.ts
tool-registry.ts
tool-repair.test.ts
tool-repair.ts
tool-run-helper.test.ts
tool-run-helper.ts
tools.test.ts
tools.ts
uninstall.test.ts
uninstall.ts
use-connected.test.tsx
use-session-commands.test.ts
use-session-commands.tsx
use-session-handoff.test.ts
use-session-handoff.ts
use-session-hash-scroll.test.ts
use-session-hash-scroll.ts
use-session-layout.ts
use-session-layout.ts
use-session-layout.test.ts
use-session-layout.ts
use-session-layout.ts
use-session-usage.test.ts
use-session-usage.ts
use-session-usage.test.ts
use-session-usage.ts
util-clipboard.ts
util-clipboard.test.ts
util-clipboard.ts
util-clipboard.test.ts
util-tool-provider.test.ts
util-tool-provider.ts
util-usage.ts
util-usage.test.ts
util-usage.ts
workspace.ts
workspace.test.ts
workspace.ts
worktree.ts
worktree.test.ts
```

## symbols in one file

**FAIL** (tokens=19302)

```
im 1
bun:test 1
est 2
imit 3
session-context-breakdown.test 3
hema 3
@opencode-ai/sdk/v2 3
context 3
@/lib/effect 3
@/util/token 3
session-context-breakdown 3
@/session/llm 3
test 5
expect 6
describe 9
toPercentLabel 10
charFromUserPart 11
estimateTokens 12
build 13
buildAssistantPart 14
buildUserPart 15
toPercentLabel 17
returns 18
"0.0%" 18
percent 18
below 18
"0.1%" 18
1000 18
toPercentLabel 19
rounds 20
nearest 20
tenth 20
toPercentLabel 21
shows 21
"100.0%" 21
percent 21
or 21
above 21
charFromUserPart 24
reads 25
text 25
part 25
skips 26
non 26
text 26
parts 26
charFromUserPart 27
handles 27
missing 27
text 27
charFromUserPart 28
handles 28
non 28
string 28
text 28
estimateTokens 31
returns 32
positive 32
estimate 32
string 32
estimateTokens 33
grows 33
input 33
length 33
build 36
constructs 37
segments 37
system 37
message 37
user 37
message 37
assistant 37
text 37
parts 37
build 38
splits 39
into 39
system 39
messages 39
user 39
messages 39
assistant 39
messages 39
build 40
computes 41
token 41
totals 41
system 41
messages 41
user 41
messages 41
assistant 41
messages 41
build 42
buildAssistantPart 44
constructs 45
assistant 45
part 45
message 45
usage 45
tokens 45
input 45
tokens 45
output 45
tokens 45
reasoning 45
tokens 45
cache 45
read 45
tokens 45
cache 45
write 45
tokens 45
buildAssistantPart 46
leaves 47
undefined 47
usage 47
assistant 47
message 47
buildAssistantPart 48
leaves 49
message 49
assistant 49
message 49
buildUserPart 51
constructs 52
user 52
part 52
message 52
text 52
buildUserPart 53
handles 54
parts 54
without 54
text 54
build 56
returns 57
segments 57
empty 57
parts 57
build 58
includes 59
percent 59
system 59
segment 59
part 59
identifiers 59
segments 60
include 61
estimates 61
segments 62
include 62
raw 62
message 62
size 62
chars 62
segments 63
map 64
same 64
raw 64
message 64
size 64
user 64
part 64
chars 64
segments 65
map 66
same 66
raw 66
message 66
size 66
assistant 66
part 66
chars 66
segments 67
compute 68
same 68
percentages 68
create 68
loadSessionContextBreakdown 68
build 68
estimateTokens 68
```

## line number accuracy

**FAIL** (tokens=19287)

```
787
```

## exported check

**FAIL** (tokens=19305)

```
YES
session-context-breakdown.test.ts 1 fil ./session-context-breakdown.-test.ts 1 fil
```
