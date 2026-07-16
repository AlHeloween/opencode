---
name: dunit
description: Run and maintain Delphi DUnit tests for Delphi projects.
---

intent:
Run and maintain Delphi DUnit tests for Delphi projects.
Build and run DUnit console runner tests.

state:
  tool: dcc32 + DUnit

scope:
  - DUnit test running and maintenance

constraints:
  (none)

invariants:
  (none)

forbidden_actions:
  (none)

## Prerequisites
Delphi toolchain on PATH (dcc32 minimum).
Initialize: call tools\init_msvc.cmd && call tools\init_delphi.cmd Win32

## Commands
Build + run all DUnit tests: tests\run_tests.cmd
Build tests only: tests\build_tests.cmd

## Adding Tests
1. Add new unit: tests\TestSomething.pas
2. Register in DUnit project file (tests\ProjectTests.dpr)
3. Re-run tests\run_tests.cmd

## Notes
DUnit assertions: CheckEquals, CheckTrue, CheckNotNull (from TestFramework).
Prefer testing pure units (no VCL) for headless deterministic runs.
Win64 builds commonly use MSBuild; inspect local test script for platform/config.
