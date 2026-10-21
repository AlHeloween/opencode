@echo off
:: Run the BUILT binary (dist/bin/opencode.exe) inside the sandbox worktree.
::
:: Why a worktree of its own: `getProjectDbPath(worktree) = {worktree}/.opencode/data/opencode.db`
:: and the worktree is the git root of the cwd (storage/db.ts:44, project.ts:350). Launching the
:: built exe from the repo would open the DEVELOPER'S real database; `wc\` is its own git repo, so
:: its DB, its jobs and its fossil chain are the sandbox's own.
SET OPENCODE_CONFIG_DIR=%~dp0
cd /d %~dp0wc
D:\zPython\opencode\dist\bin\opencode.exe %*
exit /b %ERRORLEVEL%
