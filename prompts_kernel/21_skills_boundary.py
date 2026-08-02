"""Kernel fragment: 21_skills_boundary — product SPECS are host-agnostic."""

# =============================================================================
# Product SPECS / reasoning ≠ host worktree
# =============================================================================
#
# opencode runs in many project trees. Each tree has different:
#   - project governance files
#   - skill installs
#   - rule installs
#   - path conventions
#
# Therefore product kernel SPECS and the reasoning protocol must NOT encode,
# inventory, or "care about" any particular host layout. That would be
# project-specific noise (ridiculous in a multi-host product).
#
# Runtime (TypeScript loaders) injects whatever *this session's* host provides.
# Product owns loaders + tool descriptions under packages/opencode/src/tool/*.txt.
# Host payload content is never identity SPECS.
#
# SPECS / reasoning  → process law only (gates, InfoMark, RULES, contracts)
# Runtime            → host surfaces for current worktree
# Host files         → not product identity
#

PRODUCT_TOOL_DESCRIPTIONS = "packages/opencode/src/tool/*.txt"
PRODUCT_BUILTIN_SKILLS = "packages/opencode/src/skill/"
