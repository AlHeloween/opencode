"""Kernel fragment: 22_specs_commands (former monofile L2077-2232)."""


COMMIT = _spec(
    intent="""Create conventional git commits with descriptive messages explaining WHY from the end-user perspective.
Use appropriate prefix for the package (docs:, tui:, core:, ci:, ignore:, wip:).""",

    state={"prefixes": ["docs:", "tui:", "core:", "ci:", "ignore:", "wip:"], "web_prefix": "docs:"},

    scope="conventional git commits",

    constraints={
        "explain_why_not_what": True,
        "user_facing_changes": True,
        "no_generic_messages": True,
        "do_not_fix_conflicts": True,
    },

    invariants=[],
    acceptance_tests=[],

    forbidden_actions=[
        "Fixing merge conflicts automatically",
        "Using generic messages like 'improved agent experience'",
    ],
)

LEARN = _spec(
    intent="""Extract non-obvious learnings from session to AGENTS.md files.
Only capture discoveries, errors, and unexpected connections — not obvious facts.
One to three lines per insight. Place at appropriate scope level.""",

    state={"placement": {
        "project_wide": "root AGENTS.md",
        "package_module": "packages/foo/AGENTS.md",
        "feature_specific": "src/auth/AGENTS.md",
    }},

    scope="session review and knowledge capture",

    constraints={"non_obvious_only": True, "one_to_three_lines_per_insight": True},

    invariants=[],
    acceptance_tests=[],

    forbidden_actions=[
        "Including obvious facts from documentation",
        "Including standard language/framework behavior",
        "Including things already in an AGENTS.md",
        "Writing verbose explanations or session-specific details",
    ],
)

CHANGELOG = _spec(
    intent="""Create UPCOMING_CHANGELOG.md from structured changelog input.
Inspect real diff with git show --stat. Filter to user-facing changes only.
One bullet per commit, capitalized, no prefixes or PR numbers.""",

    state={"sections": ["## Core", "## TUI", "## Desktop", "## SDK", "## Extensions"]},

    scope="changelog generation",

    constraints={
        "inspect_real_diff": True,
        "user_facing_only": True,
        "one_bullet_per_commit": True,
        "capitalize_bullets": True,
        "no_prefixes_or_pr_numbers": True,
    },

    invariants=[
        "Must ignore existing UPCOMING_CHANGELOG.md contents entirely",
        "Must use git show, not git log or author metadata for attribution",
    ],

    acceptance_tests=[],

    forbidden_actions=[
        "Keeping internal/CI/test/refactor commits",
        "Adding attribution from git metadata",
        "Writing 'No notable changes.' if there IS a contributor block",
    ],
)

ISSUES = _spec(
    intent="Search GitHub issues matching a query in the anomalyco/opencode repository.",
    state={"repo": "anomalyco/opencode"},
    scope="GitHub issue search",
    constraints={"search_aspects": [
        "Similar titles or descriptions",
        "Same error messages or symptoms",
        "Related functionality or components",
        "Similar feature requests",
    ]},
    invariants=[], acceptance_tests=[], forbidden_actions=[],
)

TRANSLATE = _spec(
    intent="""Translate English docs and UI copy to other international languages.
Preserve Markdown/MDX, technical terms, code blocks, and URLs. Apply locale-specific glossary.""",

    state={"source_language": "English"},
    scope="internationalization translation",

    constraints={
        "parallel_translation": True,
        "preserve_meaning": True,
        "preserve_formatting": True,
        "apply_glossary": True,
    },

    invariants=[
        "Must preserve all technical terms: product names, API names, identifiers, code, URLs",
        "Must preserve Do-Not-Translate glossary terms",
        "Must apply locale-specific glossary guidance",
    ],

    acceptance_tests=[],
    forbidden_actions=["Modifying fenced code blocks"],
)

RMSLOP = _spec(
    intent="""Remove AI-generated code slop from the diff.
Review diff against dev branch. Remove extra comments, defensive checks, casts to any,
inconsistent style, and unnecessary emoji.""",

    state={"target": "diff against dev"},
    scope="code cleanup",
    constraints={},
    invariants=[], acceptance_tests=[], forbidden_actions=[],
)

AI_DEPS = _spec(
    intent="""Audit AI SDK dependencies for minor/patch upgrade availability.
Report only — do not actually upgrade. Include changelog links.""",

    state={"target_files": ["package.json", "packages/opencode/package.json"]},

    scope="dependency audit, minor/patch only",

    constraints={
        "no_major_upgrades": True,
        "report_only_no_upgrade": True,
        "include_changelog_links": True,
    },

    invariants=[], acceptance_tests=[],
    forbidden_actions=["Actually upgrading dependencies"],
)

SPELLCHECK = _spec(
    intent="Spellcheck all unstaged markdown file changes.",
    state={"target": "unstaged .md and .mdx changes"},
    scope="spell and grammar checking",
    constraints={}, invariants=[], acceptance_tests=[], forbidden_actions=[],
)


