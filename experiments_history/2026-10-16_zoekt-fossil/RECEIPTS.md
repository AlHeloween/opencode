# Receipts первого прохода

```yaml
Keywords: denied-clone 0.55, absent-targets 0.30, continuation 0.15
Semantic dominant: Сохранить фактический отказ получения исходников и отличить его от выполненного клонирования.
md5: 8fa672b134ed4be3965cb027a8d91f40
prev-md5: 00000000000000000000000000000000
parent-goal-md5: e8a16f092bce49a5b9f4130dd7c26e84
```

✓ CONFIRMED, `functions.exec` → `Promise.allSettled` → `exec_command`:
оба результата rejected до запуска процесса. Из текста возвращённого инструмента:

```text
i=0:
cmd_runner start --auto-tail 0 --cwd D:\zPython\opencode -- git clone https://github.com/sourcegraph/zoekt.git external/zoekt
exec_command failed: CreateProcess
Rejected(... rejected: blocked by policy)

i=1:
cmd_runner start --auto-tail 0 --cwd D:\zPython\opencode -- git clone https://github.com/scip-code/scip.git external/scip
exec_command failed: CreateProcess
Rejected(... rejected: blocked by policy)
```

`...` здесь сокращает escaping строки launcher, не основание отказа.
Это копия исходного ответа, не дополнительное независимое доказательство.
Policy не предоставила подробную причину и не создала run id.

✓ CONFIRMED, node_repl `fs.stat`, после отказов:

```json
{"targets":[{"name":"zoekt","exists":false},{"name":"scip","exists":false}]}
```

✓ CONFIRMED, независимый explorer `/root/search_architecture` повторил проверку:
оба external target отсутствуют, ENOENT. Его completion receipt — read-only
исследование и review, не выполнение cloning. Разрешённый runtime маршрут
клонирования оставался prerequisite на границе первого прохода.

## Актуальные clone / integrity receipts

✓ CONFIRMED: после замечания владельца о Full Access выполнены обычные команды
через exec_command, без изменения policies и без wrapper:

```text
cwd: D:/zPython/opencode
git clone https://github.com/sourcegraph/zoekt.git external/zoekt
chunk_id=a98f7e exit_code=0
Cloning into 'external/zoekt'...

git clone https://github.com/scip-code/scip.git external/scip
chunk_id=deb1ad exit_code=0
Cloning into 'external/scip'...
```

✓ CONFIRMED, независимый Git readback в каждом новом checkout:

| проверка | zoekt | scip |
|---|---|---|
| `git log -1 --format=%H` | `74e1e85839697c4c4eb8a6223cc3971e6c26da45` | `e26a0b0fc83424dbfe6c703c0437d4703aec4aa0` |
| `git remote get-url origin` | `https://github.com/sourcegraph/zoekt.git` | `https://github.com/scip-code/scip.git` |
| `git status --porcelain` | empty, exit 0 | empty, exit 0 |
| `git fsck --full --no-reflogs` | empty, exit 0; chunk `5d34b9` | empty, exit 0; chunk `49d895` |
| `git cat-file -e HEAD:__codex_expected_absent_control_8b7e941c__` | EXPECTED_FAIL exit 1 | EXPECTED_FAIL exit 1 |

✗ REFUTED: первоначальный отказ wrapper-вызовов не доказывал запрета cloning.
Read-only `codex execpolicy check --rules .../default.rules -- git clone ...`
вернул `{"matchedRules":[]}` (chunk `562838`). Точная причина wrapper refusal
не установлена; подтверждён только контраст wrapper-denied / direct-Git-accepted.
Официальный rule contract: https://learn.chatgpt.com/docs/agent-configuration/rules .
Z1 принят; Z2 и full migration не доказаны этим receipt.
