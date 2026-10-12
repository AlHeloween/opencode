@echo off
rem Live smoke for sv-chain S2/S3/S4 (plan 2026-10-11_sv-chain-and-scope).
rem Project = stand/, carrying a COPY of the repo's project DB and memory index —
rem the live database is never written by this run.
cd /d "%~dp0stand" || (echo FAIL: %~dp0stand missing & exit /b 1)
set OPENCODE_CONFIG_DIR=D:\zPython\opencode\bin
bun run D:\zPython\opencode\packages\opencode\src\index.ts run "Make exactly one tool call, then stop; call no other tools. CALL 1 must be messagesearch with parameters corpus set to the string vectors, session set to the string *, and last set to 5 — no query. Quote the call's output verbatim under the heading VECTORS:" -m opencode-go/glm-5.3-flash
echo EXIT=%ERRORLEVEL%
