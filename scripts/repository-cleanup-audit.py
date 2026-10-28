#!/usr/bin/env python3
"""Local, read-only repository audit; writes only the requested audit directory.

No network, database, Git-index mutation, archive, or deletion operations.
Reference hits are evidence, never proof that an unreferenced input is unused.
"""
import argparse
import csv
import hashlib
import json
import subprocess
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRATCH = {
    "migrations_theirs.txt", "migrations_theirs_block.txt",
    "scheduler_ours.txt", "scheduler_theirs.txt",
}
REPORTS = {"scripts/.tmp-link-check/results.json", "scripts/.tmp-link-check/summary.md"}
AUDIT_PREFIX = "docs/repository-cleanup/"


def git(*args):
    return subprocess.check_output(["git", "-C", str(ROOT), *args])


def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def classify(path, refs):
    if path in SCRATCH:
        return ("Delete regenerable output", "High",
                "Merge scratch", "No consumer found; canonical migrations/scheduler retained; approval required.")
    if path in REPORTS:
        return ("Delete regenerable output", "High",
                "Old local link-check result", "Not a baseline input; current checker writes .link-check; approval required.")
    if path.startswith(".local/tasks/"):
        return ("Keep locally (already ignored)", "High",
                "Local task plan", "Preserve all task state; not a tracked asset or cleanup candidate.")
    if path.startswith("release-files/"):
        return ("Keep in GitHub", "High", "Tribal release/restoration material",
                "Release generators, tests, import snapshots, SVG sources and checklist remain together.")
    if path.startswith("attached_assets/"):
        suffix = Path(path).suffix.lower()
        if suffix == ".csv":
            return ("Keep in GitHub", "High", "Seed/import or historical input",
                    "Preserve all CSVs, including dynamic-name consumers and historical traffic snapshots.")
        if refs:
            return ("Keep in GitHub", "High", "Referenced uploaded input",
                    "Filename appears in source/tooling/docs/task plans; reference strength requires human interpretation.")
        if suffix in {".docx", ".pptx", ".pdf", ".mov", ".zip", ".ttf", ".otf", ".json"}:
            return ("Needs decision", "High", "Original source, licensed asset or snapshot",
                    "Retain pending explicit retention decision, rights review and verified external archive.")
        return ("Needs decision", "Medium", "Uploaded image, evidence or unknown user input",
                "No literal filename hit is not proof of non-use; retain until ownership/purpose is confirmed.")
    if path.startswith("screenshots/"):
        return ("Needs decision", "Medium", "Historical visual evidence",
                "Retain pending evidence-retention decision; absence of source references does not authorize deletion.")
    if path.startswith("tools/insights-crawler/output/"):
        return ("Keep in GitHub", "High", "Historical Wix migration dataset",
                "Crawler ingest/backfill tools consume dataset and images; remote source may have changed.")
    if path in {"docs/no-code-page-authoring-plan.md", "docs/proposed-next-ten.md",
                "docs/pre-launch-qa-sweep.md", "BACKLOG.md", "backlog.md"}:
        return ("Keep in GitHub", "High", "Planning/backlog or QA evidence",
                "Contains unresolved proposals/checklist items; age or partial implementation is not obsolescence.")
    if "/src/scripts/" in path or path.startswith(("scripts/", "tools/", "ops/")):
        return ("Keep in GitHub", "High", "Operational tool, test or runbook",
                "Retain one-off commands and repairs for other environments; never infer retirement from prior execution.")
    return ("Keep in GitHub", "High", "Source, configuration, test, runtime asset or instructions",
            "Conservative default; no approved removal or relocation.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, help="New audit directory relative to repository root")
    parser.add_argument("--refresh", action="store_true", help="Explicitly refresh only the three audit output files")
    args = parser.parse_args()
    output = (ROOT / args.output).resolve()
    if not output.is_relative_to(ROOT):
        parser.error("output must stay inside the repository")
    if output.exists() and not args.refresh:
        parser.error("output must be a new directory (existing evidence is never overwritten)")
    if output.exists() and any(p.name not in {"manifest.csv", "duplicates.json", "summary.json"} for p in output.iterdir()):
        parser.error("refusing to refresh a directory containing non-audit files")
    tracked = sorted(p for p in git("ls-files", "-z").decode().split("\0") if p)
    task_dir = ROOT / ".local/tasks"
    tasks = sorted(str(p.relative_to(ROOT)) for p in task_dir.glob("*.md"))
    # No arbitrary ignored-directory traversal; only task-plan paths are enumerated.
    texts = {}
    for name in tracked + tasks:
        p = ROOT / name
        if name.startswith(AUDIT_PREFIX) or name == "scripts/repository-cleanup-audit.py":
            continue
        if name.startswith(("attached_assets/", "screenshots/", "tools/insights-crawler/output/")):
            continue
        if not p.is_file() or p.stat().st_size > 2_000_000:
            continue
        try:
            content = p.read_text(encoding="utf-8")
        except (UnicodeError, OSError):
            continue
        if "\0" not in content:
            texts[name] = content.splitlines()
    # Index leaf names to retain line-level evidence without saving file contents.
    names = defaultdict(list)
    for name in tracked + tasks:
        names[Path(name).name].append(name)
    references = defaultdict(list)
    for source, lines in texts.items():
        for number, line in enumerate(lines, 1):
            for leaf, targets in names.items():
                if leaf in line:
                    for target in targets:
                        if target != source:
                            references[target].append(f"{source}:{number}")
    rows, hashes = [], defaultdict(list)
    missing = []
    for name in tracked + [p for p in tasks if p not in tracked]:
        p = ROOT / name
        exists = p.is_file()
        if not exists:
            missing.append(name)
        size = p.stat().st_size if exists else 0
        refs = references[name]
        disposition, confidence, purpose, reason = classify(name, refs)
        sha = ""
        if exists and name.startswith(("attached_assets/", "release-files/", "artifacts/synozur/public/")):
            sha = digest(p)
            hashes[sha].append(name)
        rows.append({
            "path": name, "tracked": name in tracked, "exists": exists,
            "working_bytes": size, "sha256": sha,
            "literal_reference_locations": "; ".join(refs),
            "purpose": purpose, "proposed_disposition": disposition,
            "confidence": confidence, "reason": reason,
            "action_taken": "None; approval pending",
        })
    uploads = [r for r in rows if r["path"].startswith("attached_assets/")]
    duplicates = [
        {"sha256": sha, "paths": paths}
        for sha, paths in sorted(hashes.items())
        if len(paths) > 1 and any(p.startswith("attached_assets/") for p in paths)
    ]
    summary = {
        "git_head": git("rev-parse", "HEAD").decode().strip(),
        "tracked_file_count": len(tracked),
        "tracked_working_bytes": sum(r["working_bytes"] for r in rows if r["tracked"]),
        "uploads_count": len(uploads),
        "uploads_working_bytes": sum(r["working_bytes"] for r in uploads),
        "local_task_plan_count": len(tasks),
        "local_task_plan_bytes": sum((ROOT / p).stat().st_size for p in tasks),
        "missing_tracked_paths": missing,
        "upload_only_duplicate_groups": sum(
            sum(p.startswith("attached_assets/") for p in g["paths"]) > 1 for g in duplicates),
        "upload_or_public_duplicate_groups": len(duplicates),
        "candidate_delete_bytes": sum(
            r["working_bytes"] for r in rows if r["path"] in SCRATCH | REPORTS),
        "dispositions": dict(Counter(r["proposed_disposition"] for r in rows)),
        "limitations": [
            "Literal filename hits include comments and task plans, not just executable imports.",
            "No hit does not establish non-use: dynamic paths, globs, CMS references and external tools exist.",
            "Hashes describe current working bytes, not Git LFS pointers or historical objects.",
            "No external archives, licenses, production data or remote backup availability verified.",
            "Git history, LFS objects, ignored platform tooling and private profile are untouched.",
        ],
    }
    output.mkdir(parents=True, exist_ok=args.refresh)
    with (output / "manifest.csv").open("w", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    (output / "duplicates.json").write_text(json.dumps(duplicates, indent=2) + "\n")
    (output / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
