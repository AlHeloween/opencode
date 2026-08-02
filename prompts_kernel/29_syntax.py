"""Kernel fragment: 29_syntax (former monofile L3267-3380)."""

SYNTAX_PROJECTION: dict[str, dict[str, str]] = {
    # Each entry: kernel field → {format: syntax template snippet}
    # Templates use {value} for scalar, {items} for bullet list, {dict_items} for key:value pairs
    "intent": {
        "kernel": 'CODER["intent"]  # Python dict string value',
        ".agent.txt": "# intent: <str>  # comment line at top",
        ".session.txt": "intent:\\n<str>  # YAML-style after frontmatter",
        ".mdc": "intent:\\n<str>  # YAML-style after frontmatter",
        "AGENTS.md": "intent:\\n<str>  # first section header",
        ".txt.plan": "intent:\\n<str>  # first section (no frontmatter)",
    },
    "state": {
        "kernel": 'CODER["state"]  # Python dict',
        ".agent.txt": "# state: (not used — kernel dict is authoritative)",
        ".session.txt": "state:\\nkey: value\\n  # YAML-style key:value pairs",
        ".mdc": "state:\\nkey: value  # YAML-style key:value pairs",
        "AGENTS.md": "state:\\nkey: value  # YAML-style key:value pairs",
    },
    "scope": {
        "kernel": 'CODER["scope"]  # Python dict',
        ".agent.txt": '# === SCOPE ===\\nfor k, v in SPEC["scope"].items():\\n    # {k}: {v}',
        ".session.txt": "scope:\\n- item  # dash-prefixed list",
        ".mdc": "scope:\\n- item  # dash-prefixed list",
        "AGENTS.md": "scope:\\n- item  # dash-prefixed list",
    },
    "constraints": {
        "kernel": 'CODER["constraints"]  # Python dict of bools',
        ".agent.txt": '# === CONSTRAINTS ===\\nfor k, v in SPEC["constraints"].items():\\n    # {k}: {v}  # bool values',
        ".session.txt": "constraints:\\n- text rule  # dash-prefixed list",
        ".mdc": "constraints:\\n- text rule  # dash-prefixed list",
        "AGENTS.md": "constraints:\\n- text rule  # dash-prefixed list",
    },
    "invariants": {
        "kernel": 'CODER["invariants"]  # Python list of strings',
        ".agent.txt": '# === INVARIANTS ===\\nfor inv in SPEC["invariants"]:\\n    # invariant: {inv}',
        ".session.txt": "invariants:\\n- Must ...  # dash-prefixed list",
        ".mdc": "invariants:\\n- Must ...  # dash-prefixed list",
        "AGENTS.md": "invariants:\\n- Must ...  # dash-prefixed list",
    },
    "forbidden_actions": {
        "kernel": 'CODER["forbidden_actions"]  # Python list of strings',
        ".agent.txt": '# === FORBIDDEN ===\\nfor f in SPEC["forbidden_actions"]:\\n    # DO NOT: {f}',
        ".session.txt": "forbidden_actions:\\n{items}  # dash-prefixed list",
        ".mdc": "forbidden_actions:\\n{items}  # dash-prefixed list",
        "AGENTS.md": "forbidden_actions:\\n{items}  # dash-prefixed list",
    },
    "acceptance_tests": {
        "kernel": 'CODER["acceptance_tests"]  # Python list of strings',
        ".agent.txt": '# === ACCEPTANCE TESTS ===\\nfor t in SPEC["acceptance_tests"]:\\n    # test: {t}',
        ".session.txt": "acceptance_tests:\\n{items}  # dash-prefixed list",
        ".mdc": "acceptance_tests:\\n{items}  # dash-prefixed list",
        "AGENTS.md": "acceptance_tests:\\n{items}  # dash-prefixed list",
    },
}

# Inverse map: format → list of fields with syntax templates
SYNTAX_FORMATS: dict[str, dict[str, str]] = {}
for field, formats in SYNTAX_PROJECTION.items():
    for fmt, template in formats.items():
        if fmt not in SYNTAX_FORMATS:
            SYNTAX_FORMATS[fmt] = {}
        SYNTAX_FORMATS[fmt][field] = template

# Tree-sitter grammar mapping for syntax-aware validation
TREESITTER_GRAMMARS: dict[str, str] = {
    ".agent.txt": "markdown",         # Python-like comments in markdown
    ".session.txt": "markdown",       # YAML frontmatter + markdown body
    ".mdc": "yaml",                   # YAML frontmatter (rules)
    "AGENTS.md": "markdown",          # GitHub-flavored markdown
    "kernel": "python",               # Python source
    "agent.ts": "typescript",         # TypeScript agent definitions

}


def resolve_syntax(kernel_field: str, target_format: str) -> str | None:
    """Look up the syntax template for a kernel field in a target format.

    Args:
        kernel_field: Canonical field name (e.g. 'forbidden_actions')
        target_format: Format key (e.g. '.agent.txt', '.mdc', 'AGENTS.md')

    Returns:
        Syntax template string, or None if no mapping exists.
    """
    field_map = SYNTAX_PROJECTION.get(kernel_field)
    if field_map is None:
        return None
    return field_map.get(target_format)


def render_field_to_format(kernel_field: str, value: str | list | dict,
                           target_format: str) -> str | None:
    """Render a kernel field value into target format syntax.

    For string values: {value} replaced in template.
    For list values: each item becomes a dash-prefixed bullet.
    For dict values: each key:value becomes a line.
    """
    template = resolve_syntax(kernel_field, target_format)
    if template is None:
        return None

    if isinstance(value, str):
        return template.replace("{value}", value).replace("<str>", value)
    elif isinstance(value, list):
        items = "\n".join(f"- {item}" for item in value)
        return template.replace("{items}", items)
    elif isinstance(value, dict):
        items = "\n".join(f"- {k}: {v}" for k, v in value.items())
        return template.replace("{dict_items}", items)
    return None


