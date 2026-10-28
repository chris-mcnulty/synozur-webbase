# Completed cleanup report

The user approved the six listed removals and narrow ignore rules on 2026-10-16.
No broader archival or source deletion was approved or performed.

## Removed

| Path | Working bytes removed |
| --- | ---: |
| `migrations_theirs.txt` | 78,224 |
| `migrations_theirs_block.txt` | 848 |
| `scheduler_ours.txt` | 4,619 |
| `scheduler_theirs.txt` | 5,258 |
| `scripts/.tmp-link-check/results.json` | 2,448 |
| `scripts/.tmp-link-check/summary.md` | 1,413 |
| **Total** | **92,810 (90.63 KiB)** |

These are recorded as file deletions, not merely hidden by ignore rules.
No other existing tracked path was removed or untracked.

## Retained and archived

- **2,236 original tracked paths retained**, including all 250 uploaded assets.
- **122 ignored local task plans retained**; platform tooling and private profile
  were untouched.
- **Archived paths: none.** No external archive/rights proof was supplied or
  verified, so original decks, historical documents, production snapshots and
  licensed stock media stay in Git.
- The corrected seven-slide Tribal deck remains distinct from the superseded
  eight-slide deck. All release tools/fixtures/SVGs/JPEGs remain in place.
- All seed/import inputs, migrations, repairs, tests, operational runbooks,
  source/config/lockfiles, backlogs, dated planning documents and visual evidence
  remain available. Unresolved work was indexed, not silently discarded.

## Future exclusions

Both `.gitignore` and `.replitignore` now exclude the twelve approved literal
output-directory prefixes listed in the [retention index](README.md#decision-c-approved-narrow-future-exclusions-implemented).
No blanket upload, release, CSV, JSON, Markdown, screenshot or hidden-directory
exclusion was added. Existing uploaded sources, public assets, release fixtures
and the historical crawler dataset remain included.

Future files deliberately placed in these ignored output locations will not be
protected by future Git commits/checkpoints. Root-level automatic uploads still
require review; they are not silently moved into temporary staging.

## Size accounting

Logical working-file sizes, excluding ignored dependencies/caches/Git metadata:

- Original tracked baseline: **984125664 bytes**.
- Approved existing bytes removed: **92810 bytes**.
- Final tracked-plus-new-file working set, including audit evidence:
  **984902210 bytes**.
- Net working-set increase: **776546 bytes**.

The manifest is intentional permanent operational evidence. Its addition means
this small safe cleanup increases the working set overall; do not represent it
as a large storage reduction. Git/LFS history and historical object sizes are
unchanged. No history rewrite, pruning, publication or push occurred.

## Verification

- `python3 scripts/test_repository_cleanup.py`: **4 passed**. Covers all twelve
  output prefixes, the exact Dockerignore policy, existing required tracked
  inputs, and future durable inputs outside temporary staging.
- `node --test release-files/prepare-tribal-import.test.mjs`: **3 passed**.
- `pnpm --filter @workspace/api-server exec node --import tsx --test src/lib/tribalLandingPage.test.ts`:
  **6 passed**.
- Baseline comparison: only the approved six paths deleted; all other original
  tracked files present; all fingerprinted upload/public/release assets still
  match baseline SHA-256.
- `git diff --check`: **passed**.

No application source, package, build command, startup behavior or runtime
consumer changed. No appointment creation or release regeneration was performed.
The focused cleanup checks did not need browser tests, app startup or database
operations; the configured project-wide validation ran those additional suites.

The first completion validation reported 25 passing commands, including all
configured typechecks, plus a passing completion code review. Its two failures
were `test:booking-share-image-ui` and `test:page-readability`: the frontend had
failed to start after an environment process/thread resource error (`EAGAIN`),
so the expected page elements were absent. The existing frontend workflow was
restarted successfully and the local proxy returned HTTP 200 before retrying.
This was an environment recovery, not an application-code fix.

Checkpoint creation for the approved cleanup was confirmed in local Git history.
Final completion still depends on the retried configured validation; successful
local checks alone are not represented as a passing browser run.
