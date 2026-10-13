# Host toolchain — the measured inventory (2026-10-10)

Moved verbatim from AGENTS.md (2026-10-13 split). The rule and the owner ruling stay in AGENTS.md § Host Toolchain.

Owner, verbatim: «Ты забыл про зиг в external глянь и добавь список в agents.md чтобы реально больше не гессить»,
after an agent proposed `choco install msys2` — while a **full C/C++ toolchain was already on the host**
and one had never been looked up. **Read this table before proposing ANY toolchain install.** It is
measured, not recalled; a probe that re-derives one row is cheap, but a `choco install` proposed
*before* reading this table is a defect.

| Tool | Version | Resolved path | How it is used here |
|---|---|---|---|
| **zig 0.16.0** | 0.16.0 | `external/zig-x86_64-windows-0.16.0/zig.exe` | **the in-tree C compiler.** `zig cc` compiles and links C11 against the MSVC SDK; `zig build` for Zig. Verified: `zig cc -o probe.exe probe.c` → `ZIG_CC_016_OK` (`experiments/2026-10-10_host-toolchain-probe/`) |
| **zig (choco)** | 0.15.2 | `C:\ProgramData\chocolatey\bin\zig.exe` | older second copy on PATH — **prefer the `external/` one** (0.16.0, version-matched to `packages/opentui`) |
| **MSVC cl.exe** | 19.50.35737 x64 | `C:\Program Files\Microsoft Visual Studio\18\Community\VC\Tools\MSVC\14.50.35717\bin\Hostx64\x64\` | C/C++ for the Pascal/Delphi and native surfaces |
| **rustc / cargo** | 1.100.0-nightly (2026-09-07 / 09-04) | `C:\Users\Alexander\.cargo\bin\` | `external/codegraph-rust`, `packages/desktop` (specta-bindings) |
| **go** | 1.25.4 | `C:\Program Files\Go\bin\` | — |
| **node / bun** | v24.13.0 / 1.4.2 | `C:\Program Files\nodejs\`, `~\.bun\bin` | the product itself |
| **deno** | — | `…\WinGet\Links\deno.exe` | — |
| **python** | 3.13.13 | `D:\USESoft\Python313\python.exe` | prompt_kernel, adm, probes |
| **git** | 2.55.0.windows.2 | `C:\Program Files\Git\cmd\` | product VCS |
| **cmake** | 4.2.1 | `C:\Program Files\CMake\bin\cmake.exe` | present, but no CMakeLists in-tree |

**What is NOT on this host** (measured — do not propose it as «уже есть»): `gcc`, GNU `make`,
`bash`/`sh` (Git for Windows ships neither here), MSYS2, MinGW, and a standalone LLVM —
`…\VC\Tools\MSVC\…\clang.cmd` is a **stub**: the whole file is one line,
`echo "CLANG located at c:\Program Files\LLVM\"`, and `C:\Program Files\LLVM\bin\clang.exe`
does not exist. `nmake` IS present (MSVC's make) and does **not** parse GNU Makefiles.

**The consequence that matters.** A C project whose build is `scripts/build.sh` → `make -f Makefile.cbm`
(verified in `external/codebase-memory-mcp`, `Makefile.cbm:1-8`, `_build.yml:114-148` builds Windows on
msys2 CLANG64) **cannot be built here from source** without a GNU toolchain — that is a fact about the
host, not a reason to install one uninvited. Two honest routes, and the second is the default:
1. take the project's **official prebuilt release** (the same one its `install.ps1` downloads), or
2. ask the owner before adding msys2/MinGW — ~1.5 GB, and the owner rejects it unprompted
   (owner, 2026-10-10: «вообще это форменный отстой и дыры на компе»).
