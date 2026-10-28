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
