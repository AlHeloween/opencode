@echo off
setlocal enabledelayedexpansion

set WORKTREE=%~dp0..\..
for %%P in ("%WORKTREE%") do set WORKTREE=%%~fP
set FOSSIL=%WORKTREE%\tools\fossil.exe
set TMPDIR=%TEMP%\fossil_smoke_%RANDOM%
mkdir "%TMPDIR%" 2>nul
cd /d "%TMPDIR%"

echo === 1. Init repo ===
%FOSSIL% init r.fsl > init.log 2>&1
if errorlevel 1 goto fail

echo === 2. Open with --force ===
%FOSSIL% open r.fsl --force --keep
if errorlevel 1 goto fail

echo === 3. Empty baseline commit ===
%FOSSIL% commit -m "baseline" --no-warnings --allow-fork --allow-empty
if errorlevel 1 goto fail

echo === 4. Add file and commit ===
echo version-one > f.txt
%FOSSIL% add f.txt
if errorlevel 1 goto fail
%FOSSIL% commit -m "c1" --no-warnings --allow-fork
if errorlevel 1 goto fail

echo === 5. Modify and commit again ===
echo version-two-expanded-payload > f.txt
%FOSSIL% commit -m "c2" --no-warnings --allow-fork
if errorlevel 1 goto fail

echo === 6. Close and reopen (fixes Unresolved RID) ===
%FOSSIL% close --force
if errorlevel 1 goto fail
%FOSSIL% open r.fsl --force --keep
if errorlevel 1 goto fail

echo === 7. Verify commit still works after reopen ===
echo version-three-final-payload > f.txt
%FOSSIL% commit -m "c3" --no-warnings --allow-fork
if errorlevel 1 goto fail

echo === PASS ===
cd /d %~dp0..\..
rmdir /s /q "%TMPDIR%"
exit /b 0

:fail
echo === FAILED ===
cd /d %~dp0..\..
rmdir /s /q "%TMPDIR%"
exit /b 1
