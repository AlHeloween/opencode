#!/usr/bin/env python3
"""
Consolidate bun workspace dependencies into root catalog.

For every dependency used in 2+ workspace packages, move its version
into the root catalog and replace hardcoded versions with "catalog:".

Skips:
  - workspace:*  (local packages)
  - catalog:     (already consolidated)
  - git:/file:   (non-registry sources)
  - ^/~ ranges   (keep as-is unless exact match)

Usage:
  python3 consolidate_catalog.py [--dry-run] [--min-packages 2]
"""

import json
import os
import re
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ROOT_PKG = ROOT / "package.json"
DRY_RUN = "--dry-run" in sys.argv

def find_package_jsons():
    """Yield (relative_path, json_data) for all workspace packages."""
    # Read workspace config from root
    root = json.loads(ROOT_PKG.read_text())
    patterns = root.get("workspaces", {}).get("packages", [])
    
    seen = set()
    for pattern in patterns:
        for pkg_json in sorted(ROOT.glob(f"{pattern}/package.json")):
            if "node_modules" in str(pkg_json):
                continue
            rel = str(pkg_json.relative_to(ROOT))
            if rel in seen:
                continue
            seen.add(rel)
            try:
                yield rel, json.loads(pkg_json.read_text())
            except Exception:
                pass

def parse_semver(version: str) -> tuple:
    """Parse version into sortable tuple. Handles plain versions, not ranges."""
    try:
        parts = version.split(".")
        return tuple(int(p) if p.isdigit() else 0 for p in parts[:3])
    except Exception:
        return (0, 0, 0)

def is_hardcoded(version: str) -> bool:
    """True if this is a concrete semver, not workspace/catalog/range."""
    if not isinstance(version, str):
        return False
    if version in ("workspace:*", "catalog:"):
        return False
    if version.startswith(("workspace:", "catalog:", "file:", "git:", "github:", "npm:")):
        return False
    # Ranges like ^1.0.0, ~1.0.0, >=1.0.0 — keep as-is
    if version.startswith(("^", "~", ">", "<", "=")):
        return False
    if version == "*":
        return False
    # Must look like a version number
    return bool(re.match(r"^\d", version))

def collect_deps():
    """
    Returns:
      deps: { pkg_name: [(file_rel, dep_type, version), ...] }
      files: { file_rel: json_data }
    """
    deps = defaultdict(list)
    files = {}
    
    for rel, pkg in find_package_jsons():
        files[rel] = pkg
        for dep_type in ("dependencies", "devDependencies"):
            for name, version in pkg.get(dep_type, {}).items():
                if is_hardcoded(version):
                    deps[name].append((rel, dep_type, version))
    
    return deps, files

def update_catalog(catalog, name, version):
    """Add or update a catalog entry, preserving order."""
    if name in catalog:
        catalog[name] = version
    else:
        catalog[name] = version  # Python 3.7+ dicts preserve insertion order

def main():
    deps, files = collect_deps()
    root = json.loads(ROOT_PKG.read_text())
    workspaces = root.get("workspaces", {})
    catalog = workspaces.get("catalog", {})
    
    candidates = {}
    skipped = []
    updated_files = set()
    
    for name, entries in sorted(deps.items()):
        unique_versions = sorted(set(v for _, _, v in entries), key=parse_semver)
        file_count = len(set(f for f, _, _ in entries))
        
        if file_count < 2:
            skipped.append(name)
            continue
        
        if len(unique_versions) == 1:
            candidates[name] = unique_versions[0]
        else:
            # Check if major versions differ — if so, skip (intentional incompatibility)
            majors = set(v.split(".")[0] for v in unique_versions if v[0].isdigit())
            if len(majors) > 1:
                print(f"  ⛔ {name}: major version conflict {unique_versions} — SKIPPING (likely intentional)")
                skipped.append(name)
                continue
            # Pick the newest version
            ver = unique_versions[-1]
            candidates[name] = ver
            print(f"  ⚠️  {name}: multiple versions {set(unique_versions)} → picking newest {ver}")
    
    # Update catalog
    for name, version in sorted(candidates.items()):
        if catalog.get(name) == version:
            continue  # Already correct
        update_catalog(catalog, name, version)
    
    # Remove from catalog entries not used by 2+ packages anymore
    # (keep manually curated ones — only remove auto-added that are now stale)
    
    # Write root catalog
    workspaces["catalog"] = dict(sorted(catalog.items()))
    root["workspaces"] = workspaces
    
    if DRY_RUN:
        print(f"\n=== DRY RUN: would update {len(candidates)} catalog entries ===")
        for name, ver in sorted(candidates.items()):
            old = catalog.get(name, "NEW")
            print(f"  {name}: {old} → {ver}")
        return
    
    ROOT_PKG.write_text(json.dumps(root, indent=2, ensure_ascii=False) + "\n")
    print(f"✅ Root catalog: {len(candidates)} entries updated/added")
    
    # Replace hardcoded versions with "catalog:" in sub-packages
    replaced = 0
    for rel, pkg in files.items():
        modified = False
        for dep_type in ("dependencies", "devDependencies"):
            if dep_type not in pkg:
                continue
            for name in list(pkg[dep_type].keys()):
                if name in candidates and pkg[dep_type][name] == candidates[name]:
                    pkg[dep_type][name] = "catalog:"
                    modified = True
                    replaced += 1
        
        if modified:
            pkg_path = ROOT / rel
            pkg_path.write_text(json.dumps(pkg, indent=2, ensure_ascii=False) + "\n")
            updated_files.add(rel)
    
    print(f"✅ Sub-packages: {replaced} deps → catalog: in {len(updated_files)} files")
    
    if skipped:
        print(f"\nℹ️  Skipped {len(skipped)} single-use deps (only in 1 package)")

if __name__ == "__main__":
    main()
