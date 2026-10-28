# Upload retention review — three owner-approved removals

This is a **separate approved batch**, not an extension of the six previously
approved removals. All 250 uploads were intentionally retained in that earlier
cleanup. After individually reviewing the video and both decks, the owner said:
**“you dont need to verify the copies can be deleted”.**

This later instruction explicitly waives the original external-download and
restore gate for these three paths only. Their project copies are deleted;
the other **247 uploads (297,005,961 bytes)** remain unchanged, including all
23 CSVs and all startup/seed inputs. No ignore rules or runtime consumers changed.
No new destination was selected or archive made. No external download or restore
has been verified, and no such success is claimed.

**Working-file reduction: 185,534,982 bytes (176.94 MiB)**, before small audit
documentation changes. This is not Git/LFS history or total disk-space savings.
The owner reports existing M365 masters and confirms the video license permits
storage there. No publication, history rewrite or LFS pruning occurred.

The exact paths, original sizes, hashes, provenance, owner approval and waiver
are preserved in [the removal record](approved-removals.json) and the table below.
Both decks remain distinctly identified even though their reference copies are
removed. Existing runtime MP4/WebM videos and all release fixtures remain.
There are no ignored local copies of these three removals.

## Owner responses

For `attached_assets/AdobeStock_336446857_1777150682190.mov`, the owner
reports: “we have it elsewhere saved - master”. This establishes a reported
external master, not a verified matching archive. The owner subsequently
described the location as “Offline in M365” and confirmed that the video license
allows storage there. Access, downloaded hash and restore remain unverified.
The later explicit deletion approval above supersedes its initial keep hold.

For
`attached_assets/The_Champion_System_Making_AI_Adoption_Stick_-_First_Nations__1792021848284.pptx`,
the owner confirms a master is held elsewhere and identifies this upload as a
reference copy for the completed content work. Current source searches found
no reference to this exact filename in application or release tooling; the
inventory verifier still reads it as audit evidence. The external master has
not been downloaded, compared or restored. Its corrected seven-slide authority
remains recorded distinctly; the later approval permits removal of this copy.

For
`attached_assets/The_Champion_System_Making_AI_Adoption_Stick_-_First_Nations_1792014756727.pptx`,
the owner also confirms the superseded eight-slide deck is saved elsewhere.
Its matching bytes and restoration remain unverified.
The later explicit deletion approval permits removal of this older project copy.

For all three originals above, the owner describes the saved-copy location as
“Offline in M365”. No accessible file or folder links have been supplied, so
external verification was subsequently waived by the owner. The video rights confirmation applies to
that existing storage, not to redistribution or a different archive provider.
All remaining uploads retain their original pending-review status.

## Evidence

- [Original pre-decision review sheet](review-2026-10-17/path-review.csv): all 250 original paths, working sizes,
  SHA-256, provenance limits, baseline references, exact duplicate peers and
  separate blank approval/evidence fields.
- [Pre-removal verification](review-2026-10-17/verification.json): rehashed originals and duplicate
  peers against the immutable baseline. Does not prove remote backup availability.
- [Post-removal verification](post-removal-verification.json): remaining uploads
  rehashed against the baseline, with only the three owner-approved absences.
- [Baseline manifest](../baseline-2026-10-16/manifest.csv),
  [duplicate groups](../baseline-2026-10-16/duplicates.json), and
  [previous cleanup boundary](../README.md).

The original uploads totaled **482,540,943 bytes (460.19 MiB)**. Before removal,
their working bytes matched the baseline; this is not a verification of Git history or remote
LFS availability. The baseline's 17 within-upload duplicate groups have
25,938,190 repeated bytes (24.74 MiB), including protected inputs. This is an
inventory statistic, **not approved or proposed removal savings**. A public
counterpart does not establish that an original can be discarded.

## Original review proposal (superseded only for the three approved paths)

The remaining sections preserve the proposed safeguards for any later batch.
The owner's explicit deletion and verification-waiver exception above applies
only to the three paths in the removal record. All other uploads remain held.

1. **PROTECTED_INPUT:** all 23 CSVs plus uploads with literal references in
   application/scripts/tooling. Keep tracked and in place. Some references are
   comments; the conservative hold prevents treating them as unused. Directory
   aliases, dynamic consumers, seeds and startup behavior remain protected.
   No migrations, seeds or imports are run during this review.
2. **DISTINCT_TRIBAL_SOURCE:** keep both decks, identified below, separately.
   They may be considered for backup only with individual owner approval; never
   deduplicate them, substitute one for the other, or regenerate release imports.
3. **LICENSED_ORIGINAL:** retain the original 4K stock MOV. Any future off-repository
   retention requires explicit original-source approval and verified rights.
4. **DUPLICATE_REVIEW:** owner reviews each exact path independently. Equal bytes
   do not establish identical provenance, licensing or retention requirements.
   No canonical survivor or removable path is selected at this stage.
5. **SOURCE_REVIEW:** screenshots, pasted requirements, documents, fonts, ZIPs,
   images and snapshots need owner identification and retention decisions.
   Unknown origin means keep, not disposable.

The generated lanes are conservative triage, not a fresh full dependency audit
or a claim that unreferenced paths are unused. Recheck dynamic/CMS consumers
before any later removal proposal.

### Sources that must remain distinct

| Original path | Bytes | SHA-256 | Provenance / authority |
| --- | ---: | --- | --- |
| `attached_assets/The_Champion_System_Making_AI_Adoption_Stick_-_First_Nations__1792021848284.pptx` | 25,024,502 | `a8469de6a2cbe793ee5a124a73a21fb0581627cdb89b88dc6a45343008e6dead` | Corrected, controlling seven-slide Tribal deck; slide count rechecked from PPTX package |
| `attached_assets/The_Champion_System_Making_AI_Adoption_Stick_-_First_Nations_1792014756727.pptx` | 25,026,167 | `14e3e9c9b3f5c7888ca31c5c7889c3003bf019c90a298fad0682e932161537d5` | Superseded eight-slide attachment; retain as history, never content authority |
| `attached_assets/AdobeStock_336446857_1777150682190.mov` | 135,484,313 | `9d0656b29bf3c73bce073eeffe9e9686530cd7e2a535e1e75414af73bb2ec4a9` | Original licensed stock source; baseline records 3840×2160, H.264, 28.266667 seconds |

The 1280×720 runtime `hero-bg.mp4` is not an equivalent original or a verified
reproduction recipe. Preserve it and the runtime WebM, all release files and
all CSV/startup inputs. File naming is not proof of a stock/font license.

## Owner approval process

For **each exact path** under consideration, return a sheet row or a written
decision quoting its original path and SHA-256. Unanswered paths remain tracked.
Do not use “all duplicates” or a directory wildcard as retention authorization.

1. Set `owner_retention_decision` to `KEEP_TRACKED` or `BACKUP_COPY_ONLY`.
   The latter authorizes only an archive copy, not untracking or local deletion.
   Protected inputs remain `KEEP_TRACKED`; a backup must not replace them.
2. Supply origin/owner, provenance, and rights evidence for that path. For stock
   and fonts, confirm the license permits the intended backup provider,
   storage region and access group. Identify the license record without
   putting receipts, credentials, private account details or sensitive documents
   in this public repository. Do not infer redistribution rights from web use.
   For screenshots, documents and snapshots, confirm confidentiality/access needs.
3. Specify acceptable archive access and region, and approver/date. **Only after
   these confirmations** choose and approve an organization-controlled durable
   destination with version retention and restore access. No third-party upload
   occurs before this gate. No public archive is presumed acceptable.

## Archive verification gate — not yet performed

After the above decisions, copy approved originals with their paths preserved.
Store this inventory and provenance with them, retaining the two deck names and
their authority labels. Record non-secret object IDs, versions and retention
policy. Never commit signed URLs or credentials.

For every archived path:

- Download its recorded object version into a new, isolated verification area.
  Compare actual downloaded size and SHA-256 with the inventory, not just a
  provider checksum or a same-machine copy. Record date, result and verifier.
- Restore from that downloaded archive into a separate empty restore tree,
  recreating the exact original relative path. Check size/hash again. Verify
  PPTX package integrity and respective 7/8 slide counts; verify MOV decoding/
  resolution with suitable media tooling; validate other relevant formats.
  Never restore over live inputs or run seeds as a restore test.
- Record the restore evidence and confirm that the owner can retrieve the
  archive independently of this workspace. Failure or missing evidence blocks
  any removal proposal for that path.

A local copy test is not a remote archive round trip. No successful archive or
restore can be claimed until these steps actually run.

## Only then consider a separate removal proposal

Once rights, destination, downloads and restoration are proven, present the
owner with exact paths, evidence and working-tree byte impact for a **new**
decision. Separate all three permissions:

- untrack from future Git commits/checkpoints;
- exclude from deployment;
- delete the workspace copy.

The blank approval columns reserve these later decisions; they are not requests
to approve removal now. Existing instructions prohibit removing CSV/startup
inputs. No untracking/deletion commands are included in this proposal.

**An ignored, untracked local copy is not a backup and loses protection from
future Git commits and checkpoints.** Prior history is not a verified usable
archive. Removing current files will not shrink historical Git/LFS data.
Do not publish, push, rewrite history, prune LFS, run cleanup hooks or remove
runtime/release/startup inputs as part of this batch.

## Recheck without changing approvals

`python3 scripts/upload-retention-inventory.py` rechecks the 247 remaining uploads,
duplicate peers and exactly three authorized absences without writing reports.
It rejects any other missing or changed upload, and validates removal sizes and
hashes against the original baseline. `--output <new-directory>` creates a
fresh sheet; existing directories are refused so owner decisions cannot be
overwritten. Never regenerate the immutable baseline.

## Checks

- Cleanup regression checks: **5 passed**, including hashes/sizes for all 247
  remaining uploads and exactly the three authorized absences.
- Tribal import-preservation checks: **3 passed**.
- Tribal landing-page content/release checks: **6 passed**.
- `git diff --check`: passed.
- Deletion scope comparison: exactly the three approved originals; runtime,
  release fixtures, ignore rules, LFS rules and immutable baseline unchanged.

The cleanup regression test checks repository ignore rules with host-wide
excludes disabled only for its read-only Git query. This environment's
`core.excludesfile` ignores uploads globally; it must not be mistaken for a
project policy change. No global Git setting is changed. All remaining baseline
uploads stay tracked; do not assume new untracked uploads get checkpoint protection.
