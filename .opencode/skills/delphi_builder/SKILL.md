---
name: delphi_builder
description: Build Delphi (VCL/FMX) projects from the command line with MSBuild, including environment initialization (MSVC + rsvars).
---

intent:
Build Delphi (VCL/FMX) projects from the command line with MSBuild.
Includes environment initialization (MSVC + rsvars).

state:
  tool: msbuild

scope:
  - Delphi project build with MSBuild

constraints:
  (none)

invariants:
  (none)

forbidden_actions:
  (none)

## Environment Init
adm --init-msvc [out.cmd]: Generates tools/init_msvc.cmd (calls VS VsDevCmd.bat)
adm --init-delphi [out.cmd]: Generates tools/init_delphi.cmd (resolves Delphi from adm.json delphi.bds or PATH)

## Build Flow (cmd.exe)
call tools\init_msvc.cmd
call tools\init_delphi.cmd Win64
tools\build_delphi_msbuild.cmd <project>.dpr Win64 Release

## Build Flow (PowerShell)
. .\tools\init_msvc.ps1
. .\tools\init_delphi.ps1 -Platform Win64
.\tools\build_delphi_msbuild.ps1 -Dpr <project>.dpr -Platform Win64 -Config Release

## Scripts
init_msvc.*: Detects existing MSVC env or calls VsDevCmd.bat for native x64 toolchain
init_delphi.*: Resolves Delphi root (adm.json delphi.bds > where dcc64 > common paths), calls rsvars
build_delphi_msbuild.*: Auto-generates .dproj from .dpr if missing, invokes msbuild /t:Build
Output: <project_dir>/bin/<Platform>/<Config>/<project>.exe

## Cross-platform
FMX targets: Android, iOSDevice64, iOSSimulator, OSX64, Linux64 (VCL cannot target Linux)
Linux64: Requires Delphi Remote Profile + imported SDK
