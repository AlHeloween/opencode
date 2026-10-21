@echo off
:: Third harness for the built binary: cwd is `<repo-shape>\packages\opencode` inside its OWN git
:: repo, so the worktree (and therefore the project DB) is the sandbox's, while the cwd has the
:: shape the TUI seems to require (the first two harnesses -- cwd=wc, and cwd=wc with a real commit
:: -- both failed, and the SOURCE tree failed the same way in wc, so cwd is a live variable).
SET OPENCODE_CONFIG_DIR=%~dp0
cd /d %~dp0wc2\packages\opencode
D:\zPython\opencode\dist\bin\opencode.exe %*
exit /b %ERRORLEVEL%
