"""Kernel fragment: 21_skills_boundary (former monofile L2068-2073)."""

# External skills (adm-exe, cmd-runner, rag, delphi-builder, dunit, patch-tool,
# adm-mcp, …) ship in a **separate installable package** and are updated there.
# They must NOT be embedded in this identity kernel — copies go stale.
# Runtime identity uses policy.adid_ops (tool binary how-to) only.
#

