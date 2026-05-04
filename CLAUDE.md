# Standing instructions

## Pull-request behavior

- After pushing a branch that opens a PR, **always subscribe to PR
  activity** via `mcp__github__subscribe_pr_activity` so CI failures and
  review comments arrive in the session.
- When you fix a CI failure, autoresolve a review comment, or otherwise
  act on a PR event, **always post a reply comment** on the relevant
  thread (or a top-level PR comment for CI fixes) summarising what was
  changed and why. Use `mcp__github__add_reply_to_pull_request_comment`
  for review-comment threads and `mcp__github__add_issue_comment` for
  CI / PR-level acknowledgements.
