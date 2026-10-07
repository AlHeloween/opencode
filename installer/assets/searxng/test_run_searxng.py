"""Tests for run_searxng.py (plan robot-installer B1c).

Requirement (owner, 2026-10-07: «сделать чтобы работало из коробки без заглушек … ты вообще представляешь людей
которые не умеют пользоваться компьютером?»): SearXNG starts out of the box. Its secret is created on the first start,
per install, and repaired if damaged — no installer step and no user action can be forgotten.
"""

import pathlib
import tempfile
import unittest

import run_searxng


class EnsureSecret(unittest.TestCase):
    def test_created_on_first_start_and_stable_after(self):
        with tempfile.TemporaryDirectory() as d:
            p = pathlib.Path(d) / "searxng-data" / "secret_key"
            first = run_searxng.ensure_secret(p)
            self.assertRegex(first, r"^[0-9a-f]{64}$")
            self.assertEqual(p.read_text(encoding="ascii"), first)
            self.assertEqual(run_searxng.ensure_secret(p), first, "a restart must keep the same secret")

    def test_damaged_secret_is_replaced(self):
        with tempfile.TemporaryDirectory() as d:
            p = pathlib.Path(d) / "secret_key"
            p.write_text("short", encoding="ascii")
            repaired = run_searxng.ensure_secret(p)
            self.assertRegex(repaired, r"^[0-9a-f]{64}$")

    def test_two_installs_get_different_secrets(self):
        with tempfile.TemporaryDirectory() as a, tempfile.TemporaryDirectory() as b:
            self.assertNotEqual(
                run_searxng.ensure_secret(pathlib.Path(a) / "secret_key"),
                run_searxng.ensure_secret(pathlib.Path(b) / "secret_key"),
            )


class Prepare(unittest.TestCase):
    def test_sets_secret_and_vetted_settings_from_the_bundle_layout(self):
        with tempfile.TemporaryDirectory() as d:
            root = pathlib.Path(d) / "searxng-src"
            env = {}
            run_searxng.prepare(env, root)
            self.assertRegex(env["SEARXNG_SECRET"], r"^[0-9a-f]{64}$")
            self.assertEqual(
                env["SEARXNG_SETTINGS_PATH"], str(pathlib.Path(d) / "config" / "searxng" / "settings.yml")
            )
            self.assertTrue((pathlib.Path(d) / "searxng-data" / "secret_key").exists())

    def test_an_explicit_environment_wins(self):
        with tempfile.TemporaryDirectory() as d:
            env = {"SEARXNG_SECRET": "x" * 64, "SEARXNG_SETTINGS_PATH": "custom.yml"}
            run_searxng.prepare(env, pathlib.Path(d) / "searxng-src")
            self.assertEqual(env["SEARXNG_SECRET"], "x" * 64)
            self.assertEqual(env["SEARXNG_SETTINGS_PATH"], "custom.yml")


if __name__ == "__main__":
    unittest.main()
