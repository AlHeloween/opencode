@echo off
:: The binary verification run, after the exe-adjacent dll fix.
:: cwd = <sandbox>\packages\opencode (its own git repo) so the TUI's project DB, jobs and
:: fossil chain are the sandbox's own, never the developer's live session.
:: No OPENCODE_* overrides: the previous revision set OPENCODE_CONFIG_DIR, which confounded
:: the diagnosis when the real cause was the native library (error 126).
cd /d %~dp0wc2\packages\opencode
D:\zPython\opencode\dist\bin\opencode.exe %*
exit /b %ERRORLEVEL%
