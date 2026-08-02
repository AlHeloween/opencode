"""Targeted tests for prompts_kernel (contracts)."""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pytest

# Repo root on path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from prompts_kernel import (  # noqa: E402
    Activity,
    AllowedEffect,
    ApprovalStatus,
    Budget,
    Classification,
    DiscoveryContract,
    Effect,
    Execution,
    ExecutionContract,
    Resource,
    ResourceIdentity,
    Risk,
)

class TestBudget:
    def test_defaults(self):
        b = Budget()
        assert b.maximum_created == 0
        assert b.maximum_bytes_written == 0

    def test_custom_values(self):
        b = Budget(maximum_modified=5, maximum_bytes_written=4096)
        assert b.maximum_modified == 5
        assert b.maximum_bytes_written == 4096


class TestResourceIdentity:
    def test_defaults(self):
        rid = ResourceIdentity()
        assert rid.file_id is None

    def test_with_identity(self):
        rid = ResourceIdentity(device="0x80000000", inode=12345, content_hash="sha256:abc", size=2048)
        assert rid.device == "0x80000000"
        assert rid.inode == 12345


class TestResource:
    def test_default_kind(self):
        r = Resource()
        assert r.kind == "file"
        assert r.wildcard_policy == "reject"

    def test_path_escape_detected(self):
        r = Resource(id="bad", canonical_locator="/etc/../etc/passwd", boundary="/safe")
        assert not r.canonical_locator.startswith(r.boundary)


class TestClassification:
    def test_default_conversation(self):
        c = Classification()
        assert c.activity == Activity.CONVERSATION
        assert c.effect == Effect.NO_WRITE
        assert c.risk == Risk.LOW


class TestDiscoveryContract:
    def test_defaults(self):
        dc = DiscoveryContract()
        assert dc.phase == "discovery"
        assert dc.state == "ACTIVE"
        assert "read" in dc.allowed_operations

    def test_to_json(self):
        dc = DiscoveryContract(goal_requested_text="Inspect folder ownership")
        js = dc.to_json()
        parsed = json.loads(js)
        assert parsed["goal"]["requested_text"] == "Inspect folder ownership"


class TestExecutionContract:
    def test_defaults(self):
        ec = ExecutionContract()
        assert ec.phase == "execution"
        assert ec.state == "DRAFT"

    def test_serialization_roundtrip(self):
        ec = ExecutionContract(
            contract_id="test-001",
            revision=1,
            state="FROZEN",
            classification=Classification(
                activity=Activity.OBSERVE, effect=Effect.NO_WRITE, risk=Risk.LOW,
            ),
        )
        js = ec.to_json()
        parsed = json.loads(js)
        assert parsed["contract_id"] == "test-001"
        assert parsed["state"] == "FROZEN"
        assert parsed["classification"]["activity"] == "OBSERVE"

    def test_execution_serialization(self):
        ec = ExecutionContract(
            contract_id="exec-test",
            classification=Classification(activity=Activity.MODIFY, effect=Effect.PERSISTENT_WRITE, risk=Risk.LOW),
            execution=Execution(method="structured_tool", tool="test-tool", operation="write"),
            allowed_effects=[AllowedEffect(resource_id="f", operation="write", maximum_objects=1)],
            change_budget=Budget(maximum_modified=1),
        )
        # Must set approval for MODIFY to serialize cleanly
        ec.approval.required = True
        ec.approval.status = ApprovalStatus.PENDING
        js = ec.to_json()
        parsed = json.loads(js)
        assert parsed["execution"]["method"] == "structured_tool"
        assert parsed["execution"]["tool"] == "test-tool"

