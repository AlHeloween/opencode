"""Deprecated monotest — tests live in tests/kernel/ (targeted modules).

Run:
  pytest tests/kernel/ -q
  pytest tests/kernel/test_enums.py -q
"""
from __future__ import annotations

# Re-export discovery: pytest collects tests/kernel/ when running tests/
# This file intentionally has no Test* classes.
