"""Fast ignore-policy regression checks; no network, app startup or data writes."""
import subprocess
import unittest
from pathlib import Path
import importlib.util

SPEC = importlib.util.spec_from_file_location(
    "upload_retention", Path(__file__).with_name("upload-retention-inventory.py")
)
RETENTION = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RETENTION)

ROOT = Path(__file__).resolve().parents[1]
OUTPUT_PREFIXES = {
    "/generated-artifacts/",
    "/scripts/.tmp-link-check/",
    "/.link-check/",
    "/test-results/",
    "/playwright-report/",
    "/artifacts/synozur/test-results/",
    "/artifacts/synozur/playwright-report/",
    "/artifacts/galaxy/test-results/",
    "/artifacts/galaxy/playwright-report/",
    "/artifacts/mockup-sandbox/test-results/",
    "/artifacts/mockup-sandbox/playwright-report/",
    "/attached_assets/temporary/",
}


def patterns(filename):
    return [
        line.strip() for line in (ROOT / filename).read_text().splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    ]


def git_ignored(path):
    # Test repository policy, not host-wide defaults (which may ignore uploads).
    # This command-local override does not change Git config or tracking.
    result = subprocess.run(
        ["git", "-c", "core.excludesfile=/dev/null", "-C", str(ROOT),
         "check-ignore", "--no-index", "--quiet", "--", path],
        check=False,
    )
    if result.returncode not in (0, 1):
        raise RuntimeError(f"git check-ignore failed for {path}: {result.returncode}")
    return result.returncode == 0


class CleanupIgnorePolicyTest(unittest.TestCase):
    def test_each_disposable_location_is_git_ignored(self):
        for prefix in OUTPUT_PREFIXES:
            with self.subTest(prefix=prefix):
                self.assertTrue(git_ignored(prefix.lstrip("/") + "nested/result.json"))

    def test_new_deployment_exclusions_match_the_approved_narrow_policy(self):
        # .replitignore uses Dockerignore syntax, not gitignore syntax. For these
        # literal root directory prefixes, validate the exact safe policy rather
        # than pretending git check-ignore parses Dockerignore semantics.
        self.assertEqual(set(patterns(".replitignore")), {".local"} | OUTPUT_PREFIXES)
        self.assertTrue(OUTPUT_PREFIXES.issubset(set(patterns(".gitignore"))))

    def test_required_existing_inputs_remain_present_and_git_visible(self):
        tracked = subprocess.check_output(
            ["git", "-C", str(ROOT), "ls-files", "-z"]
        ).decode().split("\0")
        prefixes = (
            "attached_assets/", "release-files/", "tools/insights-crawler/output/",
            "artifacts/synozur/public/", "artifacts/galaxy/public/",
            "artifacts/api-server/src/content/", "screenshots/", ".agents/memory/",
        )
        approved = RETENTION.approved_removals()
        keep = [p for p in tracked if p.startswith(prefixes) and p not in approved]
        self.assertGreater(len(keep), 250)
        for path in keep:
            with self.subTest(path=path):
                self.assertTrue((ROOT / path).is_file())
                self.assertFalse(git_ignored(path))
                self.assertFalse(any(
                    path.startswith(prefix.lstrip("/")) for prefix in OUTPUT_PREFIXES
                ))

    def test_only_owner_approved_originals_are_removed(self):
        rows = RETENTION.collect()
        self.assertEqual(len(rows), 247)
        self.assertEqual(sum(r["bytes"] for r in rows), 297005961)
        self.assertEqual(sum(r["original_path"].endswith(".csv") for r in rows), 23)
        self.assertEqual(
            sum(r["bytes"] for r in RETENTION.approved_removals().values()),
            185534982,
        )

    def test_new_source_input_outside_staging_is_not_ignored(self):
        for path in (
            "attached_assets/future-seed.csv", "attached_assets/future-source.pptx",
            "release-files/future-restore.json", "screenshots/evidence.png",
            "artifacts/synozur/public/future-runtime.jpg",
            "tools/insights-crawler/output/future-migration.json",
            "scripts/future-repair.ts", "docs/future-runbook.md",
        ):
            with self.subTest(path=path):
                self.assertFalse(git_ignored(path))


if __name__ == "__main__":
    unittest.main()
