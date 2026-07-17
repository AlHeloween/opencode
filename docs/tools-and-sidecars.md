# Tools and sidecars

Complete reference for **external binaries**, **auto-cached helpers**, and **project LLM tools** in this Local_Development fork. Use this when packaging a portable install (Windows or Linux), debugging “tool not found”, or deciding what belongs next to `opencode` vs on `PATH` vs inside the project.

Related:

- [Linux deploy](linux-deploy.md) — build + install procedure (links here for tools)
- [External file locations](external-file-locations.md) — path map for data/config
- [Startup & bootstrap](startup-bootstrap.md) — CodeGraph, Fossil, plugin init timing
- AGENTS.md — portable path invariants (`Global.Path.home` = worktree)

---

## 1. Three different “tools”

| Layer | Where it lives | What it is | Portable across OS? |
|-------|----------------|------------|---------------------|
| **A. Sidecar binaries** | `{exeDir}/tools/`, sometimes sibling of `opencode` | Native programs invoked by runtime or skills | **No** — rebuild/replace per OS |
| **B. Auto-cache downloads** | `{worktree}/.opencode/data/cache/bin/` (`Global.Path.bin`) | First-use fetch of `rg`, some LSPs, etc. | **No** (binaries); directory is per-worktree |
| **C. Custom LLM tools** | `{worktree}/.opencode/tool/*.ts` (and agent registry builtins) | TypeScript tools the model can call | **Yes** (source) |

Also do not confuse with:

| Concept | Not the same as sidecars |
|---------|---------------------------|
| Built-in agent tools (`read`, `write`, `edit`, `apply_patch`, `bash`, `universalsearch`, …) | Implemented in `packages/opencode/src/tool/` — no `tools/*.exe` |
| Skills (`.cursor/skills`, `.opencode/skills`) | Markdown workflows that *may* call sidecars |
| Formatters / LSPs | Resolved via `which` or download into `cache/bin` |

---

## 2. Path vocabulary

From `packages/core/src/global.ts`:

| Symbol | Value | Tools relevance |
|--------|-------|-----------------|
| `Global.Path.config` | `dirname(process.execPath)` — **install / exe dir** | Portable `tools/` lives here: `{config}/tools/` |
| `Global.Path.home` | worktree (project root), **not** OS `$HOME` | Dev fallback `{home}/tools/`; agent cwd |
| `Global.Path.bin` | `{worktree}/.opencode/data/cache/bin` | Auto-downloaded `rg`, LSPs |
| `Global.Path.data` | `{worktree}/.opencode/data` | Fossil snapshots under `fossil/{projectID}/` |
| `process.execPath` | Absolute path to `opencode` (or bun in dev) | Sibling binaries (`codegraph`, markdownify, OpenTUI native) |

Portable layout principle:

```text
{exeDir}/                      ← config + auth + tools (ship this tree)
  opencode[.exe]
  opencode.jsonc
  auth.json
  tools/                       ← sidecars (OS-specific)
  [opentui native / codegraph / markdownify]

{worktree}/                    ← project you open
  .opencode/
    data/                      ← created at runtime (do not ship secrets casually)
      cache/bin/               ← layer B downloads
      fossil/.../snapshot.fsl
    tool/                      ← layer C custom TS tools
```

Copy **exeDir** between machines of the **same OS**. Copy **worktree** for project state. Never assume Windows `.exe` tools run on Linux.

---

## 3. Windows reference tree (`tools/` in repo)

Typical contents of repo-root `tools/` and stable portable copies (`bin_tst/…-Stable/tools/`):

| File | Purpose | Runtime coupling | Linux / cross-OS |
|------|---------|------------------|------------------|
| **`fossil.exe`** | Fossil SCM for agent undo / “Modified Files” | **Hard** — snapshot + `fossil_grep` | Required equivalent; see §4.1 |
| **`rg.exe`** | Ripgrep | Soft — PATH / tools / auto-download | Optional offline; §4.2 |
| **`fd.exe`** | Fast file finder | Soft — agent/skills may invoke `fd` | Optional on PATH |
| **`grep.exe`**, **`sed.exe`** | Windows ports of Unix utils | Soft — shell only | Skip on Linux |
| **`apply_patch.exe`** | Legacy external patch CLI | **None** for model tool | Skip — in-process `apply_patch` tool |
| **`opencode-markdownify.exe`** | Doc→markdown native fallback | Soft — WASM preferred | Ship OS-native binary or rely on WASM |
| **`cmd_runner.exe`** | Interactive terminal automation | Skills / bash notes on Windows | Skip on Linux (real `bash` tool) |
| **`adm.exe`**, **`adm-rag.exe`** | ADID update manager / RAG | Skills (`adm-exe`, `rag`, `patch-tool`) | Linux ADM or `python -m adm` |
| **`ambr.exe`**, **`ambs.exe`** | ADID-related helpers | Skills / ADID workflows | Optional product layer |
| **`rclone.exe`** | Remote sync | Ad-hoc agent shell | Optional system package |
| **`jj.exe`** | Jujutsu VCS CLI | TUI footer if `.jj` exists; **not** snapshot backend | Optional system `jj` |
| **`init_msvc.*`**, **`init_delphi.*`**, **`build_delphi_*`** | MSVC/Delphi env | Delphi builder skill | Windows only |
| **`install_rag.cmd`**, **`install_rag.sh`** | RAG installers | ADID RAG setup | Keep `.sh` on Linux if using RAG |
| **`adm.json`** | ADID config sample | ADID | Portable JSON if used |

**Siblings of `opencode.exe`** (often in `bin/` / stable zip, not always under `tools/`):

| File | Purpose | Linux |
|------|---------|--------|
| `opentui.dll` | OpenTUI native renderer | `libopentui.so` (compile embed and/or sidecar) |
| `codegraph.exe` | Code index CLI | Optional Linux `codegraph`; empty DB if missing |
| `dxcompiler.dll`, `dxil.dll` | Windows DXC | Skip |
| `opencode-markdownify.exe` | Same as tools copy | No `.exe` suffix |

---

## 4. Resolution order (by consumer)

### 4.1 Fossil — required for snapshot/undo

**Code:** `packages/opencode/src/snapshot/fossil.ts`, `packages/opencode/src/tool/fossil-grep.ts`

| Priority | Path / name |
|----------|-------------|
| 1 | `{exeDir}/tools/fossil.exe` |
| 2 | `{worktree}/tools/fossil.exe` |
| 3 | `{repo}/external/fossil/fossil.exe` (source checkout only) |
| 4 | Command **`fossil`** on `PATH` |

**Important:** probes use the literal filename `fossil.exe` even on non-Windows hosts. There is no `tools/fossil` probe without the suffix.

**Linux packaging options:**

```bash
# A) Portable bundle (recommended): symlink keeps the expected name
mkdir -p "$OUT/tools"
ln -sfn "$(command -v fossil)" "$OUT/tools/fossil.exe"

# B) Distro package + PATH only
sudo apt install fossil   # or dnf/pacman/…
# ensure `fossil` is on PATH for the user/service that runs opencode

# C) Build from vendored source
cd external/fossil/fossil-src-2.28
./configure && make
# install binary, then A or B
```

**If missing:** snapshot service cannot open/init `.opencode/data/fossil/{projectID}/snapshot.fsl`; agent undo / Modified Files degrade. Logs: service `snapshot-fossil`.

**Not Fossil:** project git (`project/vcs.ts`) and TUI footer markers are separate systems. See [startup-bootstrap.md](startup-bootstrap.md).

**Decoupling from git:** A stuck `.git/index.lock` must not prevent Fossil snapshot open. Snapshot `ensureInit` runs at bootstrap (not only on first `track`). The TUI footer detects fossil via open markers **or** `{worktree}/.opencode/data/fossil/*/snapshot.fsl` (`packages/opencode/src/cli/cmd/tui/util/vcs-indicator.ts`) and prefers fossil over git when the sidecar exists.

---

### 4.2 Ripgrep — search / file index helpers

**Code:** `packages/opencode/src/file/ripgrep.ts`

| Priority | Path / name |
|----------|-------------|
| 1 | `which("rg")` / `which("rg.exe")` on Windows |
| 2 | `{exeDir}/tools/rg` or `rg.exe` (platform extension) |
| 3 | `{worktree}/.opencode/data/cache/bin/rg[.exe]` |
| 4 | **HTTP download** BurntSushi release → extract into `cache/bin` |

Platform matrix includes `x64-linux`, `arm64-linux` (tar.gz; extract uses system `tar`). Windows zip extract uses PowerShell.

**Offline / air-gapped:** ship `{exeDir}/tools/rg` or preinstall `rg` on PATH. With network, first search self-heals.

**Version:** pinned in source (`VERSION` constant, currently 15.1.0 — check file when packaging).

---

### 4.3 Markdownify

**Code:** `packages/opencode/src/util/markdownify.ts`

| Priority | Behavior |
|----------|----------|
| 1 | **WASM** in-process (`packages/wasm/markdownify` assets) — preferred |
| 2 | Native binary `opencode-markdownify` (+ `.exe` on Windows) |

Native candidates (order):

1. `{worktree}/.opencode/data/cache/bin/opencode-markdownify`
2. `{exeDir}/tools/opencode-markdownify`
3. `{exeDir}/opencode-markdownify`
4. next to `process.execPath` / argv0
5. `{worktree}/bin/…`
6. repo `bin/` and `dist/opencode-{platform}-{arch}/bin/` (dev)

Build native: `cargo build --release --manifest-path packages/native/markdownify/Cargo.toml`.

---

### 4.4 CodeGraph

**Code:** `packages/opencode/src/project/bootstrap.ts` (`initCodeGraphBg`)

| Priority | Behavior |
|----------|----------|
| 1 | If `{worktree}/.codegraph/codegraph.db` exists → no-op |
| 2 | `codegraph` on PATH, or sibling `{exeDir}/codegraph[.exe]` → spawn `codegraph init` (fire-and-forget) |
| 3 | Create empty SQLite schema in-process — **does not block** TUI |

Full indexing needs a real CLI build; empty index still allows boot.

---

### 4.5 OpenTUI native library

**Code:** `packages/opentui/packages/core/src/zig.ts` (dynamic import of platform package)

| Platform | Package | File |
|----------|---------|------|
| Windows x64 | `@opentui/core-win32-x64` | `opentui.dll` |
| Linux x64/arm64 | `@opentui/core-linux-*` | `libopentui.so` |
| Linux musl | `*-musl` variants | `libopentui.so` |
| macOS | `core-darwin-*` | `libopentui.dylib` |

Built by Zig via `packages/opentui/packages/core` (`bun run build`). Embedded into the bun-compiled `opencode` binary when present at compile time; shipping a sidecar next to the binary remains a useful fallback when debugging load failures.

---

### 4.6 apply_patch (model tool)

**Code:** `packages/opencode/src/tool/apply_patch.ts` + `packages/opencode/src/patch/`

Does **not** execute `tools/apply_patch.exe`. The Windows `apply_patch.exe` in `tools/` is legacy/extra and must not be treated as a deploy dependency.

---

### 4.7 Shell: bash, cmd, cmd_runner

| OS | Default agent shell path | Notes |
|----|--------------------------|--------|
| **Linux / macOS** | Built-in **`bash` tool** | Real bash; timeouts; permission gates |
| **Windows** | **`cmd` tool** / **`cmd_runner` skill** | bash tool docs state bash is not the primary path on Windows |

`cmd_runner.exe` is for interactive/long-lived Windows terminal sessions (skills). **Do not** require it for Linux deploy.

Safe-search heuristics in bash may treat `rg` / `fd` as low-risk (see `tool/bash.ts`); still not a hard dependency on `tools/fd.exe`.

---

### 4.8 ADID / RAG / patch-tool skills

Skills under `.cursor/skills` / `.opencode/skills` reference:

| Skill reference | Fallback |
|-----------------|----------|
| `tools/adm.exe` / `tools/adm` | `python -m adm` |
| `tools/adm-rag.exe` | pip `adm[rag]`, `install_rag.sh` |
| `tools/adm --patch-tool` | `python -m adm --patch-tool` |

These are **optional product features**, not required for core TUI agent + Fossil snapshots.

Linux: ship a Linux ADM binary as `tools/adm` (and skills may still say `.exe` on Windows docs), or rely on Python.

---

### 4.9 Formatters and language servers

**Code:** `packages/opencode/src/format/formatter.ts`, `packages/opencode/src/lsp/server.ts`

- Prefer binaries already on `PATH` (`which`).
- Else download/install into `Global.Path.bin` (gopls, zls, clangd, eslint server zip, etc.).
- Not part of the Windows `tools/` zip for a minimal portable opencode.

---

## 5. Recommended portable layouts

### 5.1 Windows stable (reference)

```text
opencode-win/
  opencode.exe
  opentui.dll
  opencode-markdownify.exe      # optional if WASM embeds
  codegraph.exe                 # optional
  opencode.jsonc
  auth.json
  tools/
    fossil.exe                  # required for snapshots
    rg.exe                      # optional offline
    fd.exe                      # optional
    # + ADID/RAG stack only if product needs them
```

### 5.2 Linux minimal (full agent + snapshots)

```text
opencode-linux/
  opencode                      # chmod +x
  opencode.jsonc
  auth.json                     # mode 0600
  tools/
    fossil.exe                  # symlink to real fossil binary (name required today)
    # rg optional if PATH or auto-download OK
```

### 5.3 Linux offline / air-gapped

```text
opencode-linux/
  opencode
  opencode-markdownify          # if WASM unavailable
  codegraph                     # optional full index
  libopentui.so                 # if not fully embedded
  tools/
    fossil.exe
    rg
    fd                          # optional
```

### 5.4 Stage script (Linux tools only)

```bash
#!/usr/bin/env bash
set -euo pipefail
OUT="${1:-/opt/opencode}"
mkdir -p "$OUT/tools"

if command -v fossil >/dev/null; then
  ln -sfn "$(command -v fossil)" "$OUT/tools/fossil.exe"
else
  echo "ERROR: fossil not found — install package or build external/fossil/fossil-src-2.28" >&2
  exit 1
fi

if command -v rg >/dev/null; then
  ln -sfn "$(command -v rg)" "$OUT/tools/rg"
fi

if command -v fd >/dev/null; then
  ln -sfn "$(command -v fd)" "$OUT/tools/fd"
elif command -v fdfind >/dev/null; then
  ln -sfn "$(command -v fdfind)" "$OUT/tools/fd"
fi

echo "tools staged under $OUT/tools"
ls -la "$OUT/tools"
```

**Never** copy Windows `tools/*.exe` PE binaries onto Linux and expect them to run.

---

## 6. What to skip when leaving Windows

| Skip | Why |
|------|-----|
| Entire `tools/*.exe` tree as-is | Wrong architecture / PE format |
| `cmd_runner.exe` | Windows interactive automation |
| `apply_patch.exe` | Unused by model tool |
| `grep.exe`, `sed.exe` | System packages on Unix |
| `init_msvc*`, `init_delphi*`, `build_delphi*` | Windows toolchains |
| `dxcompiler.dll`, `dxil.dll` | Windows DXC |
| Delphi-only skills without Linux toolchain | Not runnable |

---

## 7. Project-level TypeScript tools (layer C)

Location: `{worktree}/.opencode/tool/` (also tests under `packages/opencode/test/tool/`).

- Plain TypeScript modules registered for the LLM.
- No native compile step for the tool files themselves.
- Copy with the project; independent of Windows/Linux sidecar zip.

Builtin tools remain in `packages/opencode/src/tool/` and are compiled into the binary.

---

## 8. Verification checklist

| Check | How |
|-------|-----|
| Fossil found | `fossil version` on PATH **or** `{exeDir}/tools/fossil.exe` exists and is executable ELF on Linux |
| Snapshot works | Edit a file via agent → Modified Files / undo path; logs under `snapshot-fossil` without open/init spam |
| Ripgrep | Trigger search; first run may download; or `ls {worktree}/.opencode/data/cache/bin/rg` / `tools/rg` |
| Markdownify | Attach/open a doc type that converts; logs `markdownify: wasm loaded` or native path |
| CodeGraph | Optional; `.codegraph/codegraph.db` appears; empty index is OK |
| No PE on Linux | `file tools/*` shows ELF, not “PE32” |
| Auth/config | Still next to binary, not under OS home |

```bash
# Linux quick checks
file /opt/opencode/opencode /opt/opencode/tools/*
/opt/opencode/opencode --version
fossil version || /opt/opencode/tools/fossil.exe version
```

---

## 9. Known gaps / future cleanup

| Gap | Current workaround | Better fix |
|-----|--------------------|------------|
| Fossil lookup hardcodes `fossil.exe` | Symlink `tools/fossil.exe` → real binary; or PATH `fossil` | Probe `fossil` then `fossil.exe` on all OS |
| `_build.ps1` / `build.py` stage Windows only | Manual Linux stage ([linux-deploy.md](linux-deploy.md)) | `scripts/stage-linux.sh` + OS-aware `build.py` |
| Skills docs say `tools/adm.exe` | Provide Linux `tools/adm` or Python fallback | Dual-name docs in skills |
| Windows `tools/` committed as binaries | Dev convenience on Windows | Document-only on Linux; CI stage matrix |

---

## 10. Source map (for maintainers)

| Concern | Primary files |
|---------|----------------|
| Path roots | `packages/core/src/global.ts` |
| Fossil binary | `packages/opencode/src/snapshot/fossil.ts`, `tool/fossil-grep.ts` |
| Ripgrep | `packages/opencode/src/file/ripgrep.ts` |
| Markdownify | `packages/opencode/src/util/markdownify.ts` |
| CodeGraph init | `packages/opencode/src/project/bootstrap.ts` |
| apply_patch tool | `packages/opencode/src/tool/apply_patch.ts` |
| OpenTUI native select | `packages/opentui/packages/core/src/zig.ts` |
| Compile targets | `packages/opencode/script/build.ts` |
| Windows package stage | `_build.ps1`, `build.py` |
| Vendored Fossil | `external/fossil/fossil-src-2.28/` |
| ADID skills | `.cursor/skills/adm-exe`, `rag`, `patch-tool` |

---

## 11. Summary

1. **Ship OS-native sidecars** under `{exeDir}/tools/` (and a few siblings of `opencode`).  
2. **Fossil is the one hard sidecar** for this fork’s snapshot UX; on Linux use PATH or `tools/fossil.exe` symlink.  
3. **Ripgrep self-heals** with network; pre-ship for offline.  
4. **Do not ship** Windows PE tools, cmd_runner, apply_patch.exe, DXC, or Delphi scripts to Linux.  
5. **LLM tools** (`.opencode/tool/*.ts`) and **in-process** agent tools are separate from the `tools/` binary directory.
