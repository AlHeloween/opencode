@echo off
:: Launch the built binary EXACTLY the way a user does (the owner's own setup):
:: no OPENCODE_* overrides, cwd = the real repository. The previous harness set
:: OPENCODE_CONFIG_DIR to a sandbox that also held opencode.json.enc + the encryption key,
:: which is a plausible silent-startup killer, and it ran from a scratch cwd.
cd /d D:\zPython\opencode
D:\zPython\opencode\dist\bin\opencode.exe %*
exit /b %ERRORLEVEL%
