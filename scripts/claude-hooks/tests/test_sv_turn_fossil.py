#!/usr/bin/env python3
"""Fixture tests for the sv_turn_fossil Stop hook.

Each test builds scratch fossils in .temp/ (never the live org or project
fossils), runs scripts/claude-hooks/sv_turn_fossil.py as a subprocess with a
fixture transcript, and reads the technotes back:

- name:  from `fossil timeline -t e -R <repo>` (the `[hash] <name> (...)` line)
- body:  from `fossil wiki export -R <repo> -t chat -` (raw bytes, byte-exact)
- tags:  from the timeline line (`tags: chat`, `tags: chat, decision`, ...)

Run:  python scripts/claude-hooks/tests/test_sv_turn_fossil.py
"""

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest

TESTS = os.path.dirname(os.path.abspath(__file__))
HOOKS = os.path.dirname(TESTS)
ROOT = os.path.dirname(os.path.dirname(HOOKS))
HOOK = os.path.join(HOOKS, "sv_turn_fossil.py")
SESSION = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
SESSION8 = SESSION[:8]

if os.name == "nt":
    FOSSILS = [
        os.path.join(ROOT, "tools", "fossil.exe"),
        os.path.join(ROOT, "bin", "tools", "fossil.exe"),
        os.path.join(ROOT, "external", "fossil", "fossil.exe"),
    ]
else:
    FOSSILS = [
        os.path.join(ROOT, "tools", "fossil"),
        os.path.join(ROOT, "external", "fossil", "fossil"),
    ]
FOSSIL = next((p for p in FOSSILS if os.path.isfile(p)), "fossil")


def fossil(args, cwd, timeout=60):
    proc = subprocess.run(
        [FOSSIL] + args,
        cwd=cwd,
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    return proc.returncode, (proc.stdout or "") + (proc.stderr or "")


def expected_body(session, dominant, md5=None, canary=None):
    lines = [
        "# Turn report",
        "",
        "- agent: claude",
        "- session: %s" % session,
        "- time: <time>",
        "- dominant: %s" % dominant,
    ]
    if md5:
        lines.append("- sv md5: %s" % md5)
    elif canary:
        lines.append("- canary rejected 33-hex md5: %s" % canary)
    lines.append("")
    return "\n".join(lines)


def mask_time(body):
    out = []
    for line in body.split("\n"):
        if line.startswith("- time: "):
            out.append("- time: <time>")
        else:
            out.append(line)
    return "\n".join(out)


class HookCase(unittest.TestCase):
    def setUp(self):
        self.base = tempfile.mkdtemp(
            prefix="claude-hook-", dir=os.path.join(ROOT, ".temp")
        )
        self.proj = os.path.join(self.base, "proj")
        cell = os.path.join(
            self.proj, ".opencode", "data", "fossil", "t1"
        )
        os.makedirs(cell)
        self.repo = os.path.join(cell, "snapshot.fsl")
        code, out = fossil(["init", self.repo], self.base)
        self.assertEqual(code, 0, "fossil init project: %s" % out)
        self.orghome = os.path.join(self.base, "orghome")
        os.makedirs(self.orghome)
        self.org = os.path.join(self.orghome, "org.fossil")
        code, out = fossil(["init", self.org], self.base)
        self.assertEqual(code, 0, "fossil init org: %s" % out)
        # cwd nested one level deeper: nearest-ancestor walk must still find it.
        self.cwd = os.path.join(self.proj, "sub")
        os.makedirs(self.cwd)

    def tearDown(self):
        shutil.rmtree(self.base, ignore_errors=True)

    def run_hook(self, fixture, cwd=None, orghome=None):
        with open(
            os.path.join(TESTS, fixture), encoding="utf-8"
        ) as handle:
            transcript = handle.name
        hook_in = json.dumps(
            {
                "session_id": SESSION,
                "transcript_path": transcript,
                "cwd": cwd or self.cwd,
                "hook_event_name": "Stop",
            }
        )
        env = dict(os.environ, ORG_HOME=orghome or self.orghome)
        return subprocess.run(
            [sys.executable, HOOK],
            input=hook_in,
            capture_output=True,
            text=True,
            timeout=30,
            env=env,
            cwd=self.base,
        )

    def timeline(self, repo):
        code, out = fossil(["timeline", "-t", "e", "-R", repo], self.base)
        self.assertEqual(code, 0, "timeline: %s" % out)
        return out

    def chat_body(self, repo):
        code, out = fossil(
            ["wiki", "-R", repo, "export", "-t", "chat", "-"], self.base
        )
        self.assertEqual(code, 0, "export: %s" % out)
        return out

    def test_sv_turn_shape_matches_cell(self):
        """SV turn -> one technote, name+body byte-match cell.ts (time masked)."""
        proc = self.run_hook("turn_sv.jsonl")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        md5 = "a" * 32
        name = (
            "chat claude sv:%s: Probe dominant for fixture test "
            "(session %s)" % (md5, SESSION8)
        )
        line = self.timeline(self.repo)
        self.assertIn(name, line)
        self.assertIn("tags: chat)", line)
        body = mask_time(self.chat_body(self.repo))
        self.assertEqual(
            body,
            expected_body(
                SESSION, "Probe dominant for fixture test", md5=md5
            ),
        )

    def test_no_sv_declared(self):
        proc = self.run_hook("turn_no_sv.jsonl")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        name = "chat claude: no vector declared (session %s)" % SESSION8
        self.assertIn(name, self.timeline(self.repo))
        body = mask_time(self.chat_body(self.repo))
        self.assertEqual(
            body, expected_body(SESSION, "no vector declared")
        )
        self.assertNotIn("- sv md5:", body)

    def test_delegate_goes_to_both(self):
        proc = self.run_hook("turn_delegate.jsonl")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        md5 = "b" * 32
        name = (
            "chat claude sv:%s: Rollout delegated to the robot "
            "(session %s)" % (md5, SESSION8)
        )
        self.assertIn(name, self.timeline(self.repo))
        org_line = self.timeline(self.org)
        self.assertIn(name, org_line)
        self.assertIn("tags: chat, decision", org_line)

    def test_plain_goes_to_project_only(self):
        proc = self.run_hook("turn_sv.jsonl")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertNotIn("chat claude", self.timeline(self.org))

    def test_wrap_actions_go_to_org_as_delegation(self):
        proc = self.run_hook("turn_wrap.jsonl")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        md5 = "c" * 32
        name = (
            "chat claude sv:%s: Two ways forward for the owner "
            "(session %s)" % (md5, SESSION8)
        )
        org_line = self.timeline(self.org)
        self.assertIn(name, org_line)
        self.assertIn("tags: chat, delegation", org_line)

    def test_answer_goes_to_org_as_decision(self):
        proc = self.run_hook("turn_answer.jsonl")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        md5 = "d" * 32
        name = "chat claude sv:%s: Owner picked model A (session %s)" % (
            md5,
            SESSION8,
        )
        org_line = self.timeline(self.org)
        self.assertIn(name, org_line)
        self.assertIn("tags: chat, decision", org_line)

    def test_missing_project_fossil_posts_nothing_and_logs(self):
        # System temp, OUTSIDE the repo tree: no ancestor may hold a fossil.
        # (A dir under .temp/ would resolve to this repo's own snapshot.)
        empty = tempfile.mkdtemp(prefix="claude-hook-nofossil-")
        self.addCleanup(shutil.rmtree, empty, True)
        before = None
        log = os.path.join(ROOT, ".temp", "sv_turn_fossil.log")
        if os.path.isfile(log):
            with open(log, encoding="utf-8", errors="replace") as handle:
                before = handle.read()
        proc = self.run_hook(
            "turn_sv.jsonl", cwd=empty, orghome=self.orghome
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertNotIn("chat claude", self.timeline(self.org))
        with open(log, encoding="utf-8", errors="replace") as handle:
            after = handle.read()
        new = after[len(before):] if before is not None else after
        self.assertIn("no project fossil", new)

    def test_33hex_md5_rejected_with_canary(self):
        bad = "e" * 33
        fixture = os.path.join(TESTS, "turn_bad_md5.jsonl")
        with open(fixture, encoding="utf-8") as handle:
            text = handle.read()
        found = re.search(r"md5: ([0-9a-fA-F]+)", text)
        self.assertIsNotNone(found)
        self.assertEqual(len(found.group(1)), 33, "fixture must be 33 hex")
        proc = self.run_hook("turn_bad_md5.jsonl")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        name = "chat claude: Dominant with a bad md5 (session %s)" % SESSION8
        self.assertIn(name, self.timeline(self.repo))
        body = mask_time(self.chat_body(self.repo))
        self.assertNotIn("- sv md5:", body)
        self.assertIn(
            "- canary rejected 33-hex md5: %s" % bad, body
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
