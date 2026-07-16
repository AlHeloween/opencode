/**
 * Patch uucode for Zig 0.15.x on Windows.
 *
 * Upstream uses setCwd(package_root) on the tables generator Run step.
 * Zig 0.15 convertPathArg then panics:
 *   assert(!std.fs.path.isAbsolute(child_cwd_rel));
 * when relativizing the artifact path against an absolute package cwd.
 *
 * Fix: pass package root as argv[1] and chdir inside tables.zig instead.
 *
 * Usage:
 *   node tools/patch-uucode-windows.mjs [packageDir]
 * If packageDir is omitted, searches common Zig package caches.
 */
import fs from "node:fs"
import path from "node:path"
import os from "node:os"

const HASH = "uucode-0.1.0-ZZjBPtA_TQCWp5PIKmfm5tu1WOkKWFmBGFEMxircPfkA"

const BUILD_OLD = `    const run_build_tables_exe = b.addRunArtifact(build_tables_exe);
    run_build_tables_exe.setCwd(b.path(""));
    const tables_path = run_build_tables_exe.addOutputFileArg("tables.zig");`

const BUILD_NEW = `    const run_build_tables_exe = b.addRunArtifact(build_tables_exe);
    // Zig 0.15.x Windows: setCwd + convertPathArg panics (assert !isAbsolute).
    // Pass package root as argv[1]; tables.zig chdirs before opening UCD files.
    const pkg_root = b.pathFromRoot(".");
    run_build_tables_exe.addArg(pkg_root);
    const tables_path = run_build_tables_exe.addOutputFileArg("tables.zig");`

const TABLES_OLD = `    const ucd = try Ucd.init(main_allocator, table_configs);

    var args_iter = try std.process.argsWithAllocator(main_allocator);
    _ = args_iter.skip(); // Skip program name

    // Get output path (only argument now)
    const output_path = args_iter.next() orelse std.debug.panic("No output file arg!", .{});

    std.log.debug("Writing to file: {s}", .{output_path});

    var out_file = try std.fs.cwd().createFile(output_path, .{});`

const TABLES_NEW = `    var args_iter = try std.process.argsWithAllocator(main_allocator);
    _ = args_iter.skip(); // Skip program name

    // argv: [pkg_root] [output_path]
    // pkg_root replaces setCwd() so Zig 0.15 Windows does not panic in convertPathArg.
    const pkg_root = args_iter.next() orelse std.debug.panic("No package root arg!", .{});
    const output_path = args_iter.next() orelse std.debug.panic("No output file arg!", .{});

    // UCD loaders open relative paths like "ucd/UnicodeData.txt" from package root.
    {
        var root_dir = try std.fs.cwd().openDir(pkg_root, .{});
        defer root_dir.close();
        try root_dir.setAsCwd();
    }

    const ucd = try Ucd.init(main_allocator, table_configs);

    std.log.debug("Writing to file: {s}", .{output_path});

    // output_path is absolute (from addOutputFileArg without setCwd).
    var out_file = if (std.fs.path.isAbsolute(output_path))
        try std.fs.createFileAbsolute(output_path, .{})
    else
        try std.fs.cwd().createFile(output_path, .{});`

function candidateDirs(explicit) {
  if (explicit) return [explicit]
  const home = os.homedir()
  const zigDir = path.dirname(path.dirname(fileURLToDir()))
  return [
    path.join(home, "AppData", "Local", "zig", "p", HASH),
    path.join(home, ".cache", "zig", "p", HASH),
    path.join(zigDir, "zig-pkg", HASH),
    path.join(process.env.LOCALAPPDATA || "", "zig", "p", HASH),
  ].filter(Boolean)
}

function fileURLToDir() {
  // tools/ is under src/zig/
  return path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..")
}

function patchFile(filePath, oldText, newText, label) {
  if (!fs.existsSync(filePath)) {
    console.error(`missing: ${filePath}`)
    return false
  }
  const text = fs.readFileSync(filePath, "utf8")
  // Normalize CRLF for matching
  const norm = text.replace(/\r\n/g, "\n")
  const oldN = oldText.replace(/\r\n/g, "\n")
  const newN = newText.replace(/\r\n/g, "\n")
  if (norm.includes(newN)) {
    console.log(`${label}: already patched`)
    return true
  }
  if (!norm.includes(oldN)) {
    console.error(`${label}: expected pattern not found in ${filePath}`)
    return false
  }
  const out = norm.replace(oldN, newN)
  // Preserve original line endings style if file was CRLF
  const final = text.includes("\r\n") ? out.replace(/\n/g, "\r\n") : out
  fs.writeFileSync(filePath, final)
  console.log(`${label}: patched ${filePath}`)
  return true
}

function isAlreadyPatched(pkgDir) {
  const build = fs.readFileSync(path.join(pkgDir, "build.zig"), "utf8")
  const tables = fs.readFileSync(path.join(pkgDir, "src", "build", "tables.zig"), "utf8")
  return build.includes('pathFromRoot(".")') && tables.includes("No package root arg")
}

function patchPackage(pkgDir) {
  console.log(`patching uucode at ${pkgDir}`)
  if (isAlreadyPatched(pkgDir)) {
    console.log("already patched")
    return true
  }
  const okBuild = patchFile(path.join(pkgDir, "build.zig"), BUILD_OLD, BUILD_NEW, "build.zig")
  const okTables = patchFile(path.join(pkgDir, "src", "build", "tables.zig"), TABLES_OLD, TABLES_NEW, "tables.zig")
  return okBuild && okTables
}

const explicit = process.argv[2]
let found = false
let patched = false
const seen = new Set()
for (const dir of candidateDirs(explicit)) {
  const resolved = path.resolve(dir)
  if (seen.has(resolved)) continue
  seen.add(resolved)
  if (fs.existsSync(path.join(resolved, "build.zig"))) {
    found = true
    if (patchPackage(resolved)) patched = true
  }
}

if (!found) {
  console.error("No uucode package found to patch. Run a zig build once to fetch deps, then re-run this script.")
  process.exit(1)
}
if (!patched) {
  console.error("Failed to patch uucode package(s).")
  process.exit(1)
}
console.log("done")
