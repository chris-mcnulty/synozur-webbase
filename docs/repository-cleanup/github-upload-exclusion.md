# GitHub upload exclusion

## What can and cannot be enforced

`attached_assets` (including nested paths and case variants) is forbidden
intake, not permanent site storage. Keep the existing local ignore rules and
commit/push hooks enabled. They are the only configured controls that can stop
upload bytes leaving this workspace before a GitHub push.

GitHub Actions runs **after GitHub receives commits**. A failed check does not
undo file transfer, remove objects, clean history, or prevent a file from being
visible on another branch, tag, fork or pull request. Requiring the check on
`main` is a merge/update gate, not a repository-wide upload-transfer ban.

The repository is public and personally owned. GitHub rejected an active push
ruleset with both errors:

- `Source public repos cannot have push rules`
- `Source only org-owned repos can have push rules`

GitHub's [push-ruleset documentation](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets#push-rulesets)
describes path restrictions for eligible private/internal repositories. An
organization-owned repository on an eligible plan would be needed to pursue
this option. Changing visibility, transferring ownership, enabling paid
features, and rewriting history require separate owner decisions.

Even a server-side rejection is not a guarantee that no bytes reached the
remote service: Git transports objects before the server accepts a ref update.
Push rules prevent acceptance into the repository's commit graph; local
controls and careful handling remain necessary for preventing transfer.

## Workflow

`.github/workflows/upload-exclusion.yml` reuses
`scripts/check-no-uploads.mjs`; there is no separate path-matching policy.

- All branch and tag pushes are checked, without path filters.
- Existing refs check every incoming commit after the previous ref value.
- New refs check all reachable history, so republishing old upload-containing
  history fails even if the tip is clean.
- Deleted refs have no incoming content and skip the job.
- Pull requests use `pull_request` so the job reports a required check on the
  PR's commit, rather than `pull_request_target` (whose workflow checks are not
  evaluated as PR-required checks). They use the trusted base-branch checker.
  Only commit/tree objects are inspected. Incoming PR code is never checked
  out or executed, and no dependencies or scripts from it are installed.
- Merge groups check their incoming range.
- Manual runs check the current tree only; they do not claim to audit legacy
  history or all remote refs.
- Missing commit boundaries fail closed. Full commit history is fetched with
  a blob filter so history inspection does not require old upload blobs.
- The token has read-only contents permission; checkout does not persist it.

The job/check name is **`upload-exclusion`**, produced by **GitHub Actions**
(app ID `15368`). The workflow itself and the checker are trusted policy code:
review changes to both carefully. A required check is not protection against a
repository administrator disabling rules or changing the trusted checker.

## Repository-owner operations

The GitHub connection was reauthorized with `workflow` permission. No token was
requested in chat. Only the workflow was installed through GitHub's Contents
API; no local branches, uploaded files, site changes, or history rewrites were
pushed. The identical workflow is also maintained in this project.

The active repository ruleset is **Require upload exclusion on main**:

- Target: branch `~DEFAULT_BRANCH`, with no excluded refs or bypass actors.
- Require check `upload-exclusion` specifically from GitHub Actions.
- Require the check against the latest base (`strict`).

GitHub confirmed this rule is active with `current_user_can_bypass: never`.
Its [ruleset page](https://github.com/chris-mcnulty/synozur-webbase/rules/26002611)
is the source of truth for the live settings.

Once active, untested direct updates to `main`, including ordinary direct
Replit-to-GitHub syncs, are rejected. Use a branch and pull request whose check
passes. This does not require or perform a production deployment.

To inspect the configuration:

- [Workflow runs](https://github.com/chris-mcnulty/synozur-webbase/actions/workflows/upload-exclusion.yml)
- [Repository rules](https://github.com/chris-mcnulty/synozur-webbase/settings/rules)

Do not test rejection by uploading real intake, making dirty branches/tags, or
rewriting history. The synthetic regression suite uses disposable local Git
repositories only:

```sh
node --test scripts/check-no-uploads.test.mjs
node scripts/check-no-uploads.mjs
```

Existing upload copies in old commits, other refs, pull-request refs, caches,
and LFS remain part of the separately approved historical purge and verification
work. Installing this check does not certify that GitHub is historically clean.
