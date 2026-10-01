"""The kernel's identity tool rows equal the live ACL — through ONE committed artifact.

`prompt_kernel/identity_tools.json` is the output of `packages/opencode/script/kernel-tools-manifest.ts`, the
extractor that computes every native identity's tool sets from `agent.ts` and the tool catalog. Its TS twin,
`packages/opencode/test/agent/kernel-identity-manifest.test.ts`, fails when the runtime moves away from the
JSON; THIS file fails when the kernel rows do. On 2026-10-01 the rows still offered `multiedit` and
`applypatch`, which no catalog holds, and gave the researcher five tools its ACL denies — a model that trusts
its row makes moves the runtime refuses (owner: «чтобы потом левых ходов не было»).
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from prompt_kernel import KERNEL
from prompt_kernel.addons import IDENTITY_ADDONS

MANIFEST = json.loads((Path(__file__).resolve().parents[1] / "identity_tools.json").read_text(encoding="utf-8"))


def _row(lines: tuple[str, ...]) -> tuple[str, set[str]]:
    """`tools: all except a, b;…` → ("denied", {a, b}); `tools: a, b.` → ("allowed", {a, b})."""
    text = " ".join(lines)
    body = re.match(r"tools:\s*(.*?)\s*(?:;|\.$)", text)
    assert body, f"not a tools row: {text!r}"
    listed = body.group(1)
    kind = "denied" if listed.startswith("all except ") else "allowed"
    names = listed.removeprefix("all except ")
    return kind, {name.strip() for name in names.split(",")}


def test_every_identity_row_is_in_the_manifest() -> None:
    runtime = {identity.id: identity.runtime for identity in KERNEL.identities}
    assert sorted(runtime[addon.identity_id] for addon in IDENTITY_ADDONS) == sorted(MANIFEST)


def test_identity_rows_equal_the_live_acl() -> None:
    runtime = {identity.id: identity.runtime for identity in KERNEL.identities}
    drift = {}
    for addon in IDENTITY_ADDONS:
        kind, names = _row(addon.lines)
        live = set(MANIFEST[runtime[addon.identity_id]][kind])
        if names != live:
            drift[addon.identity_id] = {"kernel_only": sorted(names - live), "acl_only": sorted(live - names)}
    # A drift names the identity AND the tools on each side, so the fix is readable from the red itself.
    assert drift == {}
