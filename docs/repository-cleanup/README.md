# Repository cleanup: approved limited cleanup

## Current upload policy

`attached_assets` must NEVER be in GitHub, with no required-input exceptions.
The entire intake directory is ignored and existing uploads are untracked while
local originals are preserved. Promote needed brand assets, media and data to
appropriate permanent locations and update consumers; do not restore upload
tracking. The commit/push guard rejects tracked intake and outgoing commits
containing it. Local ignored originals are no longer checkpoint-protected.

Historical GitHub commits are not erased by untracking files. Their purge
requires a separately coordinated repository-owner history cleanup, including
old branches/tags, pull-request references, caches and LFS objects where relevant.
Git hooks can be bypassed, so this policy also requires collaborator compliance.

## Original audit baseline (superseded where it retained uploads)

Audit date: 2026-10-16. The user approved deleting the six paths in Decision A
and adding the narrow exclusions in Decision C. **Only those six existing files
were removed.** No unique source input was untracked, archived or relocated.
No production reads/writes, bookings, publication, push, Git history rewrite,
LFS pruning, or cleanup hooks were run.

## Evidence and scope

- [Separate upload retention review](upload-retention/README.md): per-path
  evidence for the 250 original uploads. The owner subsequently approved removal
  of the video and both decks, expressly waiving external-copy verification.
  The other 247 uploads remain unchanged. The original cleanup below is historical.

- [Path-by-path manifest](baseline-2026-10-16/manifest.csv): every tracked path
  plus the ignored local Markdown task plans, with working size, tracked/existing
  status, literal reference locations, purpose, disposition, confidence and reason.
- [Exact duplicate groups](baseline-2026-10-16/duplicates.json): SHA-256 matches
  involving uploads and their release/public counterparts. Matching bytes are
  evidence of duplication, **not permission to delete the original**.
- [Baseline totals](baseline-2026-10-16/summary.json): source revision, counts,
  sizes and limitations. The baseline predates this audit's own new files.
- `scripts/repository-cleanup-audit.py`: local standard-library-only inventory
  generator. It reads tracked files and local task plans and writes only its
  requested report directory. It never executes application or Git cleanup code.

The baseline is immutable pre-approval evidence: its action column says
approval pending because that was the state when captured. The final outcome is
recorded below and in [the final report](final-report.md). These audit records
are intentional permanent operational evidence, not disposable generated output.

For historical Wix restoration input checks, use the
[crawler offline preflight](../../tools/insights-crawler/README.md#historical-dataset-retention-and-offline-restoration-preflight).
It reads the preserved dataset without importing content or accessing a
database. A pass does not authorize shrinking or relocating it; all consumers
must be updated together under a separately approved, verified archive plan.

The manifest includes all 2,242 tracked files (984,125,664 working bytes;
938.54 MiB), not just apparently unused uploads. All were present. The 250
tracked uploads total 482,540,943 bytes (460.19 MiB). There are 17 exact-duplicate
groups within uploads, with 25,938,190 bytes (24.74 MiB) beyond one copy per group.
There are 29 groups involving uploads when compared with public/release assets.
These are **not approved savings**. Local plans now number 122, totaling 449,644
bytes; all remain ignored and untouched. Baseline `git status --short` was empty.

`git count-objects -v` reported 64,456 KiB loose objects plus 541,835 KiB packed
objects (~592.08 MiB). The Git directory occupied ~723 MiB, including other
metadata. Removing current files will not remove old versions or shrink that
history. No history cleanup is proposed.

### Reference audit

Reviewed package commands, `.replit` workflow/deployment commands, Vite aliases,
API build/config/startup imports, post-merge setup, tracked `.github` configuration,
operational docs, scripts and local task plans. This checkout has no tracked
`.github/workflows` directory; do not infer that an external CI service is absent.
Literal hits in the CSV are leaf-filename matches, so common names such as
`results.json` can refer to other directories. They include comments and plans,
not just executable dependencies. No hit never establishes that a user input is
unused; dynamic paths, CMS records and external tools are not fully statically
discoverable.

Important indirect consumers:

| Input | Consumer / reason to retain |
| --- | --- |
| `attached_assets/Videos_1776733452229.csv` | API startup calls `repairImportedVideoContent`; its helper probes repository/package-relative paths |
| `attached_assets/events_1776704614264.csv` | Events route and event seed use package-relative paths |
| Services, Solutions, Service+Methodologies, Solution+Capabilities CSVs | `ingestServices.ts` combines an asset directory with a filename mapping |
| Collateral and From+The+Feed CSVs | `seedCollateral.ts` and `seedPosts.ts` combine directory and leaf name |
| Applications, Case+Studies, Team, White+Papers+and+eBooks, URL_Redirects_Export CSVs | Individual import/seed commands; retain even when not wired to startup |
| Uploaded homepage editorial/stock images | `seedHomepageAssets.ts` resolves a mapping of filenames dynamically |
| `tools/insights-crawler/output/posts.json` and `output/images/**` | Crawler `src/ingest.ts` resolves local dataset/image paths; `backfill-authors.ts` and API `fixPostAuthors.ts` also use the dataset |
| Other crawler JSON/report files | Historical migration evidence plus discovery/crawl inputs; not guaranteed reproducible from today's site |
| `release-files/tribal-*.json` | API `tribalLandingPage.test.ts`, import preparer and operator release/restore flow |
| `release-files/*-og.svg` | `prepareTribalRelease.ts` reads original SVGs and emits SVG/JPEG variants |
| `artifacts/synozur/public/videos/hero-bg.{mp4,webm}` | Both home implementations use these runtime formats |
| `attached_assets` directory | Both Vite apps define `@assets`; preserve directory and any future/imported consumers |

Recursive/glob readers checked include static OG/proof-link source scans,
the removed-identifiers scanner, and the mockup preview plugin. They scan their
own source/preview scopes, not the six proposed removals. Link-check baseline
selection is configurable, but its default output is root `.link-check`, not
`scripts/.tmp-link-check`; no active consumer of that old exact directory was
found. Do not run migrations, seeds, cleanup hooks, crawler imports, development
Tribal apply scripts, or release generators merely to test this inventory.

## Decision A: six approved removals, implemented

Approval covered removing these **tracked paths and their filesystem copies**.
All six have been deleted from the working tree and are recorded as deletions
for the task commit. They remain in previous Git history; no archive is needed
for these scratch outputs. No unique user upload is in this batch.

| Path | Bytes | Evidence |
| --- | ---: | --- |
| `migrations_theirs.txt` | 78,224 | Old merge side; live `src/lib/migrations.ts` remains the startup source |
| `migrations_theirs_block.txt` | 848 | Audit indexes/retention migration already present in live migrations |
| `scheduler_ours.txt` | 4,619 | Old merge side; canonical scheduler includes pending-subscriber cleanup |
| `scheduler_theirs.txt` | 5,258 | Old merge side; canonical scheduler also includes audit pruning/reconcile |
| `scripts/.tmp-link-check/results.json` | 2,448 | Old localhost:5123 sample result; not an active baseline |
| `scripts/.tmp-link-check/summary.md` | 1,413 | Companion sample report from the same run |
| **Total** | **92,810** | **90.63 KiB** |

Only task-plan references were found for the four scratch filenames; no package,
workflow, build, startup, import, glob, or operational consumer was found. Deleting
the scratch files is not deleting actual migrations or the scheduled worker.

## Decision B: retain source and unresolved evidence

**No external archive or license proof has been verified.** Therefore archive
outside GitHub is only a possible later disposition, not an accomplished action.
All unique source inputs remain tracked in this proposal.

### Tribal sources and release boundary

- **Controlling corrected deck (seven slides):**
  `attached_assets/The_Champion_System_Making_AI_Adoption_Stick_-_First_Nations__1792021848284.pptx`.
  SHA-256: `a8469de6a2cbe793ee5a124a73a21fb0581627cdb89b88dc6a45343008e6dead`.
- **Superseded wrong attachment (eight slides):**
  `attached_assets/The_Champion_System_Making_AI_Adoption_Stick_-_First_Nations_1792014756727.pptx`.
  SHA-256: `14e3e9c9b3f5c7888ca31c5c7889c3003bf019c90a298fad0682e932161537d5`.
  Keep as historical source pending a separate archive/retention decision, not as
  content authority. File slide counts were checked without importing or editing.
- Retain all of `release-files/`, API Tribal content/tests, and both
  `prepareTribalRelease.ts` and `applyTribalDevelopment.ts`. The latter changes
  development data and is not a verification command.
- Retain original SVGs, public JPEG runtime copies, release JPEGs, JSON patches,
  the production-reviewed import, change manifest and checklist. Equal bytes in
  different locations do not remove generator/test/operator dependencies.
- Booking rollout/restoration closure has not been verified. No release tool or
  fixture is retired. Never regenerate a reviewed production import from defaults.

### Licensed media, historical documents and uploads

Retain DOCX/PDF inputs (including both MPF revisions), Terms/FAQ sources, archives,
fonts, stock images, traffic exports, user screenshots, pasted requirements and
production snapshots. Unknown provenance is a reason to ask, not to delete.

`attached_assets/AdobeStock_336446857_1777150682190.mov` is a hydrated LFS source:
135,484,313 bytes, H.264, 3840×2160, 28.266667 seconds. The public
`hero-bg.mp4` is 2,870,083 bytes, H.264, 1280×720, also 28.266667 seconds.
They are different files/resolutions; matching duration suggests derivation, not
byte identity or a verified reproduction recipe. Preserve the higher-resolution
licensed original until rights, editable-source needs and a verified archive are
settled. The runtime WebM/MP4 remain in Git.

`.gitattributes` also names `artifacts/synozur/public/videos/hero-bg.mov`, which is
not in the current tracked tree. Leave that historical rule alone; it does not
establish a second present MOV or authorize removing the stock source.

Before any future untracking of unique material: choose a durable external
destination, confirm permissions/license allow it, copy originals and metadata,
record original path/size/SHA-256, re-download and compare hashes, test restoration,
and get explicit retention approval. A local ignored copy is **not an archive**.
Once ignored and untracked it is no longer protected by future Git commits or
checkpoints; old history is not a substitute for a usable external backup.

### Scripts, documentation, and backlog

All 48 API script paths have individual rows in the manifest. Keep every one:
migrations, schema provisioning, GCS/SPE migration, reindex/backfill/repair
commands, reconfirmation tooling, seeds, tests and release tools. Some standalone
commands have no package script or literal inbound reference; that does not make
them obsolete. Retain `scripts/post-merge.sh` and `scripts/git-hygiene.sh` without
executing them as audit checks.

Keep `BACKLOG.md` (technical debt) and `backlog.md` (product/launch work) distinct.
Do not merge their case-sensitive names or discard unchecked items.

| Document | Assessment |
| --- | --- |
| `docs/no-code-page-authoring-plan.md` | Proposal plus durable design choices; existing editing features alone do not establish all phases complete |
| `docs/proposed-next-ten.md` | Dated prioritization, not authoritative completion state; contains unresolved white-paper/webinar tasks still present in the current queue |
| `docs/pre-launch-qa-sweep.md` | Dated source-level QA evidence plus human/production checks not proven complete |
| `screenshots/icon-audit/resources-desktop-unchanged.jpg` | Keep pending explicit evidence-retention decision |
| `screenshots/team-typography-mobile-unchanged.jpg` | Keep pending explicit evidence-retention decision |
| `screenshots/width-audit/company-os-mobile.jpg` | Keep pending explicit evidence-retention decision |
| Other docs, ops/research runbooks, instructions and useful agent memory | Keep; no blanket Markdown/hidden-directory exclusion |

This page is the maintained cleanup/retention index. It links the old plans
rather than pretending their backlog is resolved. Consolidation/removal requires
an item-level completion check and preservation of unresolved decisions first.

## Decision C: approved narrow future exclusions, implemented

Applied additions to **both** `.gitignore` and `.replitignore`, using
repository-root-specific paths (the files have different pattern formats):

```text
/generated-artifacts/
/scripts/.tmp-link-check/
/.link-check/
/test-results/
/playwright-report/
/artifacts/synozur/test-results/
/artifacts/synozur/playwright-report/
/artifacts/galaxy/test-results/
/artifacts/galaxy/playwright-report/
/artifacts/mockup-sandbox/test-results/
/artifacts/mockup-sandbox/playwright-report/
/attached_assets/temporary/
```

`attached_assets/temporary/` is an explicitly disposable staging location
for future uploads only, **not** a rule excluding today's auto-uploaded files.
The platform's existing auto-upload filenames at `attached_assets/` root would
still need review before committing; do not claim automatic classification.
Browser tools should write their reports into these designated directories.
Durable visual evidence belongs in a deliberately retained location instead.

Preservation allowlist: `attached_assets/*.csv` and every other existing upload,
`artifacts/*/public/**`, `artifacts/api-server/src/content/**`, `release-files/**`,
`tools/insights-crawler/output/**`, source/tests/scripts, lockfiles/config,
instructions, runbooks and memory. None of the proposed prefixes is an ancestor
of these current required inputs. No blanket `attached_assets`, `output`, `data`,
`screenshots`, `*.json`, `*.md`, `.agents` or `release-files` exclusion.
Existing `.local/` Git and `.local` deployment exclusions remain unchanged.
Build `dist` outputs are not newly deployment-excluded.

Ignoring a file does not remove it from Git. Deployment exclusion does not
untrack it. Untracking does not delete its local copy. Actual deletion does.
Decision A explicitly covers tracking **and** filesystem removal; Decision C
only changes future inclusion rules. No other existing tracked file was untracked.

## Verification and final reporting

After implementation, application files and dependencies are unchanged.
The new audit script and documentation do not affect app rendering; no workflow
restart, browser test, startup execution or production activity is needed.
The inventory and dependency assertions can be checked entirely from files.

1. **Passed:** exact six-path deletion diff; all other baseline tracked paths
   exist; every fingerprinted upload/runtime/release input matches its original
   SHA-256.
2. **Passed:** four ignore-policy tests using `git check-ignore --no-index`,
   including every retained tracked upload/public/release/crawler/memory asset,
   future durable inputs, and all designated disposable directories. The
   Dockerignore-formatted deployment policy is checked separately as an exact
   literal-prefix allowlist rather than pretending Git parses it.
3. **Passed:** three offline Tribal import/preparer tests and six landing-page
   fixture tests. No booking creation, seed, startup or release generator ran.
4. **Passed:** `git diff --check`. No runtime source/type layer changed, so no
   app rebuild/typecheck or browser run was necessary for these file removals.
5. See final report for byte accounting. Cleanup checkpoint creation was
   confirmed in Git history. Initial completion validation passed 25 commands
   and code review; two browser suites failed while the frontend was down after
   a process/thread resource error. The frontend was restored (HTTP 200) before
   retrying completion validation; no application code was changed.

Re-run the lightweight policy checks with
`python3 scripts/test_repository_cleanup.py`.

**Final removal/archive/retention report:** removed 6 (92,810 bytes); archived 0;
original tracked paths retained 2,236; all 250 uploads and 122 local plans retained.
The new audit evidence/tool/tests are additional bytes, not cleanup savings.
No application dependency was removed. Further asset archival, deduplication or
planning-document deletion needs a separate explicit retention decision.
