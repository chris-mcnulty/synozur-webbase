#!/usr/bin/env python3
"""Read-only upload verification; create a NEW approval sheet, never modify assets.

Standard library only. No network, archive, index mutation, removal or ignore edits.
Existing output directories are refused so human decisions cannot be overwritten.
"""
import argparse
import csv
import hashlib
import json
from pathlib import Path
import re
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / "docs/repository-cleanup/baseline-2026-10-16"
CORRECTED = "attached_assets/The_Champion_System_Making_AI_Adoption_Stick_-_First_Nations__1792021848284.pptx"
SUPERSEDED = "attached_assets/The_Champion_System_Making_AI_Adoption_Stick_-_First_Nations_1792014756727.pptx"
MOV = "attached_assets/AdobeStock_336446857_1777150682190.mov"
APPROVALS = ROOT / "docs/repository-cleanup/upload-retention/approved-removals.json"


def approved_removals():
    """Only the three owner-reviewed paths can be excepted from baseline checks."""
    record = json.loads(APPROVALS.read_text())
    removals = {r["path"]: r for r in record["paths"]}
    if len(record["paths"]) != 3 or set(removals) != {CORRECTED, SUPERSEDED, MOV}:
        raise ValueError("Removal approval must name exactly the three reviewed originals.")
    if record.get("verification_waived_by_owner") is not True:
        raise ValueError("Missing explicit owner verification waiver.")
    return removals


def sha256(path):
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def collect():
    with (BASE / "manifest.csv").open(newline="") as stream:
        baseline = [r for r in csv.DictReader(stream)
                    if r["path"].startswith("attached_assets/")]
    duplicates = json.loads((BASE / "duplicates.json").read_text())
    approved = approved_removals()
    peers = {p: [q for q in group["paths"] if q != p]
             for group in duplicates for p in group["paths"]}
    tracked = set(subprocess.check_output(
        ["git", "-C", str(ROOT), "ls-files", "-z", "--", "attached_assets"]
    ).decode().rstrip("\0").split("\0"))
    expected = {r["path"] for r in baseline}
    if tracked - expected or (expected - tracked) - approved.keys():
        raise ValueError("Upload tracking differs from baseline; reconcile before review.")
    rows = []
    for source in baseline:
        name = source["path"]
        path = ROOT / name
        if name in approved:
            decision = approved[name]
            if (decision["bytes"] != int(source["working_bytes"])
                    or decision["sha256"] != source["sha256"]):
                raise ValueError(f"Removal evidence differs from baseline: {name}")
            if path.exists():
                raise ValueError(f"Approved removal has not been applied: {name}")
            continue
        size = path.stat().st_size
        digest = sha256(path)
        if size != int(source["working_bytes"]) or digest != source["sha256"]:
            raise ValueError(f"Upload differs from baseline: {name}")
        for peer in peers.get(name, []):
            if sha256(ROOT / peer) != digest:
                raise ValueError(f"Duplicate peer differs from baseline: {peer}")
        refs = source["literal_reference_locations"]
        protected = path.suffix.lower() == ".csv" or any(
            ref.startswith(("artifacts/", "scripts/", "lib/", "tools/"))
            for ref in refs.split("; ")
        )
        role = "Uploaded input; owner, origin and rights not established"
        if path.suffix.lower() in {".ttf", ".otf"}:
            role = "Uploaded font source; font license and archive permission unverified"
        elif "AdobeStock" in path.name:
            role = "Stock identifier in filename; purchaser, receipt and license unverified"
        if name in {CORRECTED, SUPERSEDED}:
            with zipfile.ZipFile(path) as deck:
                slides = sum(bool(re.fullmatch(r"ppt/slides/slide\d+\.xml", n))
                             for n in deck.namelist())
            expected = 7 if name == CORRECTED else 8
            if slides != expected:
                raise ValueError(f"Unexpected slide count: {name}: {slides}")
            role = (f"Tribal source; {slides} slides; "
                    + ("corrected controlling deck" if name == CORRECTED
                       else "superseded wrong attachment; NOT content authority"))
        elif name == MOV:
            role = ("Stock 4K original source; baseline documents 3840x2160 H.264, "
                    "28.266667s; runtime 720p MP4 is not an equivalent original")
        rows.append({
            "original_path": name,
            "bytes": size,
            "sha256": digest,
            "provenance_evidence": role,
            "evidence_source": "docs/repository-cleanup/README.md; baseline-2026-10-16/manifest.csv",
            "baseline_purpose": source["purpose"],
            "baseline_literal_references": refs,
            "baseline_verified_duplicate_paths": " | ".join(peers.get(name, [])),
            "review_lane": ("PROTECTED_INPUT" if protected else
                            "DISTINCT_TRIBAL_SOURCE" if name in {CORRECTED, SUPERSEDED} else
                            "LICENSED_ORIGINAL" if name == MOV else
                            "DUPLICATE_REVIEW" if peers.get(name) else "SOURCE_REVIEW"),
            "recommended_retention": ("KEEP_TRACKED_REQUIRED_INPUT" if protected else
                                      "KEEP_TRACKED_PENDING_OWNER_REVIEW"),
            "owner_retention_decision": "",
            "owner_provenance_and_rights_evidence": "",
            "approved_archive_access_and_region": "",
            "approved_by_and_date": "",
            "archive_object_and_version": "",
            "download_size_sha256_evidence": "",
            "restore_evidence": "",
            "untracking_approval": "",
            "local_deletion_approval": "",
            "deployment_exclusion_approval": "",
            "action_taken": "NONE",
        })
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, help="New evidence directory; never overwritten")
    args = parser.parse_args()
    rows = collect()
    summary = {
        "baseline": str(BASE.relative_to(ROOT)),
        "verified_upload_count": len(rows),
        "verified_bytes": sum(r["bytes"] for r in rows),
        "review_lanes": {lane: sum(r["review_lane"] == lane for r in rows)
                         for lane in sorted({r["review_lane"] for r in rows})},
        "all_remaining_uploads_match_baseline": True,
        "duplicate_peers_rehashed": True,
        "archive_destination": None,
        "owner_confirmed_video_rights_for_existing_m365_storage": True,
        "archive_downloads_verified": False,
        "restores_verified": False,
        "verification_waived_by_owner": True,
        "approved_reduction_bytes": sum(r["bytes"] for r in approved_removals().values()),
        "actions_taken": [
            {"action": "OWNER_APPROVED_REMOVAL", **r}
            for r in approved_removals().values()
        ],
    }
    if args.output:
        args.output.mkdir(parents=True, exist_ok=False)
        with (args.output / "path-review.csv").open("x", newline="") as stream:
            writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
            writer.writeheader()
            writer.writerows(rows)
        (args.output / "verification.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
