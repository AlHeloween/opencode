"""opencode_prompts_kernel — Reasoning & Execution Control Protocol Kernel (package).

Topic-sliced modules; public API re-exported here:
  from opencode_prompts_kernel import Activity, render_runtime_kernel, ...

Skills are NOT embedded — separate installable package.
"""
from __future__ import annotations

from pathlib import Path as _Path

__all__: list[str] = []

_FRAGMENTS = [
    "01_enums",
    "02_info_mark",
    "03_semantic_vector",
    "04_delta",
    "05_svm_anchor",
    "06_contracts",
    "07_digest",
    "08_validation",
    "09_execution_permit",
    "10_state_machine",
    "11_state_record",
    "12_classification",
    "13_bug_fix",
    "14_plan_cluster",
    "15_handlers",
    "16_example",
    "17_communication",
    "18_conformance",
    "19_specs_base",
    "20_specs_agents",
    "21_skills_boundary",
    "22_specs_commands",
    "23_specs_github",
    "24_specs_policies",
    "25_specs_default",
    "26_specs_grounding",
    "27_runtime_dict",
    "28_runtime_render",
    "29_syntax",
    "30_epistemic",
    "31_prompt_ir"
]

_COMMON_IMPORTS = r"""
import ast
from collections.abc import Mapping
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
import sys
from types import MappingProxyType
from typing import Optional, Any, Callable
from enum import Enum
import hashlib
import json
import math
import uuid
"""


def _bootstrap() -> None:
    g = globals()
    exec(compile(_COMMON_IMPORTS, "<kernel_imports>", "exec"), g)
    base = _Path(__file__).resolve().parent
    for name in _FRAGMENTS:
        path = base / f"{name}.py"
        src = path.read_text(encoding="utf-8")
        exec(compile(src, str(path), "exec"), g)
    pub = [
        k
        for k in g
        if not k.startswith("_")
        or k
        in (
            "_ALL_SPECS",
            "_SPEC_FIELDS",
            "_TIER_A_AGENTS",
            "_TIER_A_POLICIES",
            "_TIER_B_COMMANDS",
            "_KERNEL_SYMBOLS",
            "_PROJECTION_PREFIXES",
            "_FIELD_TO_IR",
            "_spec",
            "_validate_spec",
            "_count",
            "_render_runtime_mapping",
            "_render_spec_block",
        )
    ]
    g["__all__"] = sorted(pub)


_bootstrap()
