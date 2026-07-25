# Deploy opencode to Linux

Guidelines for taking this **Local_Development** fork (portable TUI agent) from a known-good Windows build to a working Linux installation.

This fork is **not** the upstream `curl | bash` release. Windows helpers (`_build.ps1`, `build.py` stage step) target `opencode.exe` + `opentui.dll`. On Linux you **build on Linux** (or use Nix) and assemble a portable directory the same way the Windows `bin/` / `bin_tst/…-Stable/` layout works.

---

## 1. Portable model (same on every OS)

| Role | Path | Notes |
|------|------|--------|
| **Executable dir** | directory containing `opencode` | Global config + auth live **here** (`Global.Path.config` = `dirname(process.execPath)`) |
| **Worktree / “home”** | directory you launch against (project root) | `Global.Path.home` = worktree, **not** `$HOME` |
| **Runtime data** | `{worktree}/.opencode/data/` | DB, logs, cache, fossil snapshots, backups (gitignored) |
| **Project config** | `{worktree}/.opencode/` | `opencode.json(c)`, agents, skills, plugins |
| **Sidecar tools** | `{exeDir}/tools/` and/or `{worktree}/tools/` | Fossil, rg, fd, etc. |

Design intent: copy **install dir + project** to another machine and run with zero OS home / XDG dependency.

See also: [External file locations](external-file-locations.md), [Startup & bootstrap](startup-bootstrap.md), AGENTS.md “opencode paths”.

### What is *not* portable across OS

- Native binaries (`opencode`, `libopentui` / `opentui.dll`, `opencode-markdownify`, `codegraph`, `fossil`, `rg`, …)
- Windows-only helpers under `tools/` (`.exe`, Delphi/MSVC scripts, `dxcompiler.dll` / `dxil.dll`)
- Encrypted auth blobs are fine to copy if the **same** machine-side secrets/config apply; never commit `auth.json` / `*.enc` to public git

---

## 2. Target matrix

| Host | Binary name from `script/build.ts` | OpenTUI native package | Notes |
|------|--------------------------------------|------------------------|--------|
| Linux x86_64 (glibc, AVX2) | `opencode-linux-x64` | `@opentui/core-linux-x64` → `libopentui.so` | Default modern desktops/servers |
| Linux x86_64 baseline | `opencode-linux-x64-baseline` | same | Older CPUs / some VMs (`--baseline`) |
| Linux arm64 (glibc) | `opencode-linux-arm64` | `@opentui/core-linux-arm64` | Graviton, Pi 4/5 64-bit |
| Alpine / musl | `opencode-linux-*-musl` | `core-linux-*-musl` | Build with musl targets; do not mix glibc binary on musl |

Pick **one** arch + libc. Mixing a glibc binary with Alpine (musl) fails at dynamic load.

---

## 3. Prerequisites (build machine = Linux preferred)

Install on the **Linux** machine where you compile (or a matching container/VM).

### Required

| Tool | Why | Typical install |
|------|-----|-----------------|
| **Bun** 1.3+ | Package manager + `bun --compile` | [bun.sh](https://bun.sh) |
| **Zig** (OpenTUI’s pin; see `packages/opentui`) | Native TUI renderer (`libopentui.so`) | ziglang.org or distro package |
| **Rust** + `cargo` | `opencode-markdownify` + WASM crates | rustup |
| **Python 3.11+** | Kernel prompt render (`opencode_prompts_kernel.py`) | distro `python3` |
| **git** | Clone / project VCS | distro |
| C toolchain | Zig/Rust link | `build-essential` (Debian/Ubuntu), `base-devel` (Arch), etc. |

Optional but recommended:

| Tool | Why |
|------|-----|
| **fossil** | Agent undo / “Modified Files” snapshots (required for full snapshot feature) |
| **ripgrep** (`rg`), **fd** | Search helpers (also auto-cached under data when missing) |
| **pytest**, **xxhash** (pip) | Kernel tests / optional `build.py` |
| **wasm-pack** | If rebuilding WASM packages from scratch |

Debian/Ubuntu sketch:

```bash
sudo apt update
sudo apt install -y build-essential git curl python3 python3-pip \
  pkg-config libssl-dev zlib1g-dev fossil ripgrep fd-find
# Bun:
curl -fsSL https://bun.sh/install | bash
# Rust:
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
# Zig: install the version OpenTUI expects (check packages/opentui docs / zig build)
```

Terminal: any modern terminal with a good TTY (WezTerm, Kitty, Alacritty, gnome-terminal). Truecolor + Unicode recommended.

---

## 4. Get the source

```bash
git clone <your-remote>/opencode.git
cd opencode
git checkout Local_Development   # or the tag/commit you froze as “stable”
bun install
```

Sync the prompt kernel into the binary’s embed path:

```bash
python3 opencode_prompts_kernel.py \
  --render-runtime packages/opencode/src/session/prompt/opencode_prompts_kernel.txt
```

Optional integrity:

```bash
python3 -c "import opencode_prompts_kernel as k; print(len(k._KERNEL_SYMBOLS))"
# Full suite (from repo root):
python3 -m pytest tests/ -q
```

---

## 5. Build on Linux (recommended path)

Do **not** copy Windows `opencode.exe` / `opentui.dll` to Linux. Build natively.

### 5.1 OpenTUI (Zig + TS)

```bash
cd packages/opentui/packages/core
bun run build          # native (host) + lib
cd ../solid && bun run build
cd ../three && bun run build
cd ../../../..
```

Host build produces `libopentui.so` under the Zig lib dir and packages it as `@opentui/core-linux-<arch>` (and sibling `packages/opentui/packages/core-linux-*` when present).

Cross-compile all OpenTUI natives (optional, slow):

```bash
cd packages/opentui/packages/core
bun scripts/build.ts --native --all
```

### 5.2 Rust markdownify + WASM

On Linux, prefer cargo directly (Windows uses `_build_rust.ps1`):

```bash
# Native markdownify CLI
cargo build --release \
  --manifest-path packages/native/markdownify/Cargo.toml

# WASM modules used by the binary (if your tree expects them under packages/wasm)
# Follow packages/wasm and any existing scripts; ensure packages/wasm/core/pkg assets exist
# if you rely on sidecar WASM (embedded assets are preferred when compile embeds them).
```

Output binary (no `.exe`):

`packages/native/markdownify/target/release/opencode-markdownify`

### 5.3 opencode compile

```bash
cd packages/opencode
# Host platform only (linux-x64 or linux-arm64):
bun run script/build.ts --single

# Optional: older CPUs
# bun run script/build.ts --single --baseline
```

Result:

```text
packages/opencode/dist/opencode-linux-x64/bin/opencode
# or opencode-linux-arm64, …-baseline, …-musl
```

Smoke:

```bash
./packages/opencode/dist/opencode-linux-x64/bin/opencode --version
```

### 5.4 Nix (optional alternate)

Repo includes `flake.nix` / `nix/opencode.nix` (upstream-style single binary). Useful for hermetic glibc builds; still verify this fork’s Fossil tools + portable layout after install.

```bash
nix build .#opencode   # if flake outputs match your checkout
```

---

## 6. Assemble a portable install directory

Mirror the stable Windows layout (`bin_tst/…-Stable/`), with Linux names.

### Layout

```text
opencode-linux/                 # portable install root = exeDir
  opencode                      # main binary (chmod +x)
  libopentui.so                 # OR rely on embed from bun compile; keep if loaded from sidecar
  opencode-markdownify          # optional native fallback (WASM preferred)
  codegraph                     # optional; indexing is fire-and-forget
  opencode.jsonc                # global config (create or copy)
  auth.json                     # credentials (private)
  gateway.jsonc                 # optional
  tools/
    fossil.exe                  # Linux fossil binary or symlink — see tools-and-sidecars.md
    rg                          # optional offline
    fd                          # optional
    # do NOT copy Windows PE .exe tools as-is
```

### Stage script (example)

```bash
#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
ARCH="${ARCH:-$(uname -m)}"
case "$ARCH" in
  x86_64|amd64) PLAT=linux-x64 ;;
  aarch64|arm64) PLAT=linux-arm64 ;;
  *) echo "unsupported arch: $ARCH"; exit 1 ;;
esac

OUT="${1:-$ROOT/dist/portable-linux}"
BIN="$ROOT/packages/opencode/dist/opencode-$PLAT/bin"
mkdir -p "$OUT/tools"

cp -f "$BIN/opencode" "$OUT/opencode"
chmod +x "$OUT/opencode"

# markdownify
MF="$ROOT/packages/native/markdownify/target/release/opencode-markdownify"
if [[ -f "$MF" ]]; then
  cp -f "$MF" "$OUT/opencode-markdownify"
  chmod +x "$OUT/opencode-markdownify"
fi

# OpenTUI .so (if not fully embedded — keep next to binary for FFI load paths)
for so in \
  "$ROOT/packages/opentui/packages/core-linux-x64/libopentui.so" \
  "$ROOT/packages/opentui/packages/core/node_modules/@opentui/core-linux-x64/libopentui.so" \
  "$ROOT/node_modules/@opentui/core-linux-x64/libopentui.so"
do
  if [[ -f "$so" ]]; then
    cp -f "$so" "$OUT/libopentui.so"
    break
  fi
done

# Optional: codegraph if you built a Linux binary
# cp -f path/to/codegraph "$OUT/codegraph" && chmod +x "$OUT/codegraph"

echo "Portable tree: $OUT"
"$OUT/opencode" --version
```

Ship as tarball:

```bash
tar -C dist -czf opencode-linux-x64-portable.tar.gz portable-linux
```

---

## 7. Tools and sidecars (summary)

Full inventory, resolution order, layouts, and verification:

**→ [Tools and sidecars](tools-and-sidecars.md)**

Short form for Linux deploy:

| Need | Action |
|------|--------|
| **Fossil** (snapshots / undo) | Install `fossil` on PATH **or** `ln -s $(command -v fossil) {exeDir}/tools/fossil.exe` (literal `.exe` name required by code today) |
| **rg** | PATH, `{exeDir}/tools/rg`, or first-use auto-download into `.opencode/data/cache/bin/` |
| **fd**, ADID/RAG, rclone, jj | Optional; system packages or Linux-native sidecars only |
| **apply_patch.exe**, **cmd_runner.exe**, **grep/sed.exe**, Delphi/MSVC, DXC | **Do not ship** — unused or Windows-only |
| **Custom LLM tools** | `{worktree}/.opencode/tool/*.ts` — copy with project |

```bash
mkdir -p /opt/opencode/tools
ln -sfn "$(command -v fossil)" /opt/opencode/tools/fossil.exe
# optional offline: ln -sfn "$(command -v rg)" /opt/opencode/tools/rg
```

Never copy the Windows `tools/*.exe` PE tree onto Linux as-is.

---

## 8. Deploy to a target machine

### Option A — portable directory (matches Windows stable zip)

1. Copy `opencode-linux/` (or extract tarball) to e.g. `~/apps/opencode/` or `/opt/opencode/`.
2. Copy or create **config next to the binary**:
   - `opencode.jsonc` — models, permissions, navigation allow-lists, plugins
   - `auth.json` — provider credentials (secure mode `0600`)
3. Point projects at their worktrees; first run creates `{worktree}/.opencode/data/`.

```bash
chmod 700 ~/apps/opencode
chmod 600 ~/apps/opencode/auth.json   # if present
chmod +x ~/apps/opencode/opencode
```

### Option B — single binary on PATH (lighter)

```bash
install -Dm755 packages/opencode/dist/opencode-linux-x64/bin/opencode ~/.local/bin/opencode
```

Config then lives in `~/.local/bin/` (same directory as the binary). Prefer a dedicated install dir so auth/config are not mixed into a multi-tool bin folder.

### Option C — project-local (dev-like)

```bash
# From project worktree:
/path/to/opencode-linux/opencode .
# or
/path/to/opencode-linux/opencode /path/to/project
```

Data: `/path/to/project/.opencode/data/`.

---

## 9. Configuration and secrets

### Global (exe-adjacent)

| File | Purpose |
|------|---------|
| `opencode.jsonc` / `opencode.json` | Models, agents, permissions, `navigation`, plugins |
| `auth.json` | OAuth / API keys for providers |
| `gateway.jsonc` | Gateway |
| `mcp-auth.json` | MCP OAuth |

Env overrides (subset): `OPENCODE_CONFIG`, `OPENCODE_CONFIG_DIR`, `OPENCODE_DB`, `OPENCODE_PURE`, `OPENCODE_FAST_BOOT`, `OPENCODE_SERVER_PASSWORD`.

### Project

| Path | Purpose |
|------|---------|
| `.opencode/opencode.json(c)` | Project overrides |
| `.opencode/AGENTS.md` | Project agent rules |
| `.opencode/agent|skill|command|plugins|…` | Extensions |
| `.opencode/data/` | **All** runtime state — backup this for session continuity |

### Migrating from Windows

Safe to copy:

- `opencode.jsonc` (paths: convert Windows paths to Linux; fix `navigation.allow` / external dirs)
- Provider keys (prefer re-auth if unsure)
- Project `.opencode/data/` if you want the same SQLite sessions **and** you accept same-host path assumptions inside stored content

Do **not** expect Fossil snapshot `.fsl` or absolute Windows paths inside sessions to resolve without remapping.

---

## 10. Run

```bash
# TUI on a project
/opt/opencode/opencode /path/to/project

# Headless API (default port 4096)
/opt/opencode/opencode serve --port 4096

# Web UI helper
/opt/opencode/opencode web
```

Shell profile convenience:

```bash
export PATH="/opt/opencode:$PATH"
# fossil already on PATH, or:
export PATH="/opt/opencode/tools:$PATH"
```

### systemd (optional headless server)

```ini
# /etc/systemd/system/opencode-serve.service
[Unit]
Description=OpenCode API server
After=network.target

[Service]
Type=simple
User=opencode
WorkingDirectory=/var/lib/opencode/projects/default
ExecStart=/opt/opencode/opencode serve --port 4096
Restart=on-failure
# Environment=OPENCODE_PURE=1
# Environment=OPENCODE_SERVER_PASSWORD=...

[Install]
WantedBy=multi-user.target
```

Protect secrets with file permissions and, if exposed, reverse proxy + TLS.

---

## 11. Verification checklist

Run after deploy:

| Check | Command / expectation |
|-------|------------------------|
| Binary | `./opencode --version` prints version |
| TUI starts | `./opencode /tmp/oc-smoke` opens UI; quit cleanly |
| Data path | `{worktree}/.opencode/data/opencode.db` created |
| Logs | `{worktree}/.opencode/data/log/` has recent files |
| Config | edits to exe-dir `opencode.jsonc` reflected on restart |
| Auth | `/connect` or existing providers list models |
| Snapshot | with Fossil available: agent edit → “Modified Files” / undo path works |
| Permissions | `navigation.allow` / external dirs behave as on Windows stable |
| Cache stats | TUI shows provider cache ratio (informational only) |

Quick smoke without TUI interaction:

```bash
WORKDIR=$(mktemp -d)
/opt/opencode/opencode --version
# Start serve and hit health if your build exposes it, or just ensure process stays up:
timeout 5 /opt/opencode/opencode serve --port 4097 || true
```

---

## 12. Operational notes (Linux)

### Permissions and external directories

Same semantics as the stable Windows build: external directory access goes through permission / navigation rules. Use absolute Linux paths in allow-lists (`/home/...`, `/data/...`).

### Performance

- Cold start is dominated by binary size + plugin init (see [startup-bootstrap.md](startup-bootstrap.md)).
- `OPENCODE_FAST_BOOT=1` — UI does not wait for full sync ready.
- `OPENCODE_PURE=1` — skip external plugin origins install path.

### File watching

`@parcel/watcher` uses inotify on Linux. Raise watches if needed:

```bash
# temporary
sudo sysctl fs.inotify.max_user_watches=524288
```

### Headless / no TTY

Use `serve` / `web`. Pure TUI requires a real terminal.

### Alpine / containers

Build **musl** targets (`script/build.ts` linux musl entries + OpenTUI musl packages). Base image needs a writable worktree for `.opencode/data`. Prefer glibc images (Debian/Ubuntu) unless you intentionally target Alpine.

---

## 13. What this fork’s Windows automation does *not* do yet

| Windows helper | Linux gap |
|----------------|-----------|
| `_build.ps1` | Stages `opencode.exe`, `opentui.dll`, Windows markdownify; no linux stage |
| `build.py` | Same Windows outputs; `step_rust` invokes `pwsh` + `_build_rust.ps1` |
| `bin/` / `bin_tst/*-Stable/` | Windows-only binaries in tree |
| `fossil.ts` path probes | Prefer `fossil.exe` name; use PATH or `tools/fossil.exe` symlink (§7) |

A future `scripts/stage-linux.sh` (or extending `build.py`) should:

1. Detect host OS  
2. Build OpenTUI + markdownify + `script/build.ts --single`  
3. Stage `dist/portable-linux/` as in §6  
4. Resolve Fossil as `tools/fossil` **and** PATH-safe name  

Until then, treat §5–§6 as the canonical Linux procedure.

---

## 14. Minimal “golden path” summary

```bash
# On Linux x86_64, from a frozen Local_Development commit:
git checkout <stable-commit>
bun install
python3 opencode_prompts_kernel.py \
  --render-runtime packages/opencode/src/session/prompt/opencode_prompts_kernel.txt \
  --render-skills .opencode/skills .cursor/skills

(cd packages/opentui/packages/core && bun run build)
(cd packages/opentui/packages/solid && bun run build)
(cd packages/opentui/packages/three && bun run build)

cargo build --release --manifest-path packages/native/markdownify/Cargo.toml

(cd packages/opencode && bun run script/build.ts --single)

mkdir -p /opt/opencode/tools
cp packages/opencode/dist/opencode-linux-x64/bin/opencode /opt/opencode/
chmod +x /opt/opencode/opencode
# config + auth next to binary
# fossil on PATH or: ln -s "$(command -v fossil)" /opt/opencode/tools/fossil.exe

/opt/opencode/opencode /path/to/your/project
```

---

## Related docs

- [docs/README.md](README.md) — doc index  
- [tools-and-sidecars.md](tools-and-sidecars.md) — full tools inventory and resolution order  
- [startup-bootstrap.md](startup-bootstrap.md) — cold start, plugins, Fossil vs git  
- [external-file-locations.md](external-file-locations.md) — path map  
- [architecture.md](architecture.md) — prompt, checkpoint, agents  
- [CONTRIBUTING.md](../CONTRIBUTING.md) — `bun dev` / localcode  
- [AGENTS.md](../AGENTS.md) — portable path invariants (do not point `Global.Path.home` at OS home)
