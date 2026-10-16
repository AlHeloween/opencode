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
клонирования остаётся prerequisite; повтор через иной launcher не выполнялся.
