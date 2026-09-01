from __future__ import annotations

import re
from collections import Counter
from difflib import SequenceMatcher
from functools import lru_cache
from typing import Collection, Mapping

from .model import Kernel


SEMANTIC_OVERLAP_THRESHOLD = 0.58
SEMANTIC_OVERLAP_ALLOWLIST: Mapping[tuple[str, str], str] = {}
REPEATED_NGRAM_ALLOWLIST: frozenset[str] = frozenset()


def _tokens(text: str) -> tuple[str, ...]:
    return tuple(re.findall(r"[a-z0-9_]+", text.lower()))


def normalized_token_count(text: str) -> int:
    return len(_tokens(text))


@lru_cache(maxsize=None)
def semantic_similarity(left: str, right: str) -> float:
    left_tokens = _tokens(left)
    right_tokens = _tokens(right)
    left_set = set(left_tokens)
    right_set = set(right_tokens)
    jaccard = len(left_set & right_set) / len(left_set | right_set) if left_set | right_set else 0.0
    sequence = SequenceMatcher(None, " ".join(left_tokens), " ".join(right_tokens)).ratio()
    return max(jaccard, sequence)


def find_unapproved_semantic_overlaps(kernel: Kernel) -> list[str]:
    rules = [*kernel.shared_rules]
    rules.extend(rule for gate in kernel.gates for rule in gate.local_rules)
    rules.extend(rule for protocol in kernel.protocols for rule in protocol.local_rules)
    overlaps = []
    for state_id, description in kernel.state_fields.items():
        for rule in rules:
            score = semantic_similarity(description, rule.text)
            key = (state_id, rule.id)
            if score >= SEMANTIC_OVERLAP_THRESHOLD and key not in SEMANTIC_OVERLAP_ALLOWLIST:
                overlaps.append(f"{state_id} <> {rule.id}: {score:.3f}")
    return sorted(overlaps)


def repeated_ngrams(
    text: str,
    *,
    width: int,
    minimum: int,
    allowlist: Collection[str] = (),
) -> dict[str, int]:
    tokens = _tokens(text)
    counts = Counter(" ".join(tokens[index:index + width]) for index in range(len(tokens) - width + 1))
    return {
        phrase: count
        for phrase, count in sorted(counts.items())
        if count >= minimum and phrase not in allowlist
    }
