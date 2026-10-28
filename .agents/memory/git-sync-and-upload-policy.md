---
name: Git sync and upload policy
description: Absolute upload exclusion and preservation constraints for syncing older Replit history to GitHub.
---

`attached_assets` must NEVER be in GitHub, with no required-input exceptions.
Required site files must move to appropriate permanent paths; upload intake is
transient. Preserve unique local originals rather than equating untracking with
permission to destroy them.

**Why:** The user explicitly repeated that upload commits were never approved.

**How to apply:** Keep the whole directory ignored and untracked, retain the
upload guard, and check outgoing history rather than just the latest tree.

The GitHub sync recovery preserved original Replit history on local recovery
branches and put the current project snapshot on a clean main based on GitHub's
existing tip. Those old local histories must not be pushed.

**Why:** A normal merge would reintroduce upload-bearing commits; a separate
GitHub cleanup commit had also made the two main branches diverge.

**How to apply:** Never push all branches or bypass the upload guard. Review
merges from older task branches for reintroduced historical uploads. Current-tree
removal and clean sync do not erase uploads already in historical GitHub commits.

For task forks created before the recovery, reapply only their task-specific
changes onto the recovered main; do not replay their entire divergent ancestry.

**Why:** Automatic task syncing can otherwise try to replay many historical
upload additions even though the task itself changed only clean policy files.

**How to apply:** Compare the task-only diff, preserve recovered main's unrelated
source and memory changes, and verify the resulting ancestry contains only the
intended new task changes. This is local task integration, not permission to
force-push or rewrite GitHub history.

The current public, personally owned GitHub repository cannot use push path
rules. Required Actions checks are post-transfer merge gates, not upload bans.

**Why:** GitHub rejected both repository visibility and ownership as ineligible;
Actions starts after commit transfer.

**How to apply:** Keep local guards. Explain that untested direct default-branch
syncs are blocked by the required check, while other refs and historical copies
still need care. Ownership/visibility changes require a separate owner decision.
