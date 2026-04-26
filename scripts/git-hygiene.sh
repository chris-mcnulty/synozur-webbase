#!/usr/bin/env bash
# Self-healing git hygiene for the Replit task-agent integration.
#
# Two jobs, both safe to run repeatedly and on every checkout:
#   1. Prune subrepl-* remotes whose worktree no longer exists
#      (Replit's task-agent worktree manager adds these and never reaps
#      them when the worktree is dismissed, so .git/config bloats over
#      time and contributes to push timeouts).
#   2. Remove a stale .git/index.lock that no live process owns
#      (created by an agent merge whose git child was killed before it
#      could rename(2) the index back; resurfaces every few minutes
#      until manually cleared).
#
# Also installs a thin .git/hooks/pre-push that re-runs this script,
# so hygiene happens before every push regardless of how the push was
# initiated. Pre-push exits 0 unconditionally — hygiene never blocks a
# push, even if a sub-step errors.
#
# Tunables (env):
#   STALE_LOCK_MINUTES   how old index.lock must be before we touch it (default 5)
#   GIT_HYGIENE_QUIET    set to 1 to silence "pruned ..." stderr lines

set -u

GIT_DIR="$(git rev-parse --git-dir 2>/dev/null)" || exit 0
TOPLEVEL="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
STALE_LOCK_MINUTES="${STALE_LOCK_MINUTES:-5}"

log() {
  [ "${GIT_HYGIENE_QUIET:-0}" = "1" ] && return 0
  printf 'git-hygiene: %s\n' "$*" >&2
}

# --- 1. Prune dead subrepl-* remotes -----------------------------------------
prune_dead_subrepl_remotes() {
  local live_worktrees
  live_worktrees="$(git worktree list --porcelain 2>/dev/null | awk '/^worktree /{print $2}')"

  local key url name path alive wt
  while IFS=' ' read -r key url; do
    [ -z "${key:-}" ] && continue
    name="${key#remote.}"; name="${name%.url}"
    case "$name" in subrepl-*) ;; *) continue ;; esac

    alive=0
    case "$url" in
      file://*)  path="${url#file://}" ;;
      /*)        path="$url" ;;
      ./*|../*)  path="$TOPLEVEL/$url" ;;
      *)         path="" ;;  # non-local URL, leave alone
    esac

    if [ -z "$path" ]; then
      alive=1
    elif [ -e "$path" ]; then
      alive=1
    fi

    if [ "$alive" = "0" ] && [ -n "$live_worktrees" ]; then
      while IFS= read -r wt; do
        [ -z "$wt" ] && continue
        if [ "$path" = "$wt" ] || [ "$url" = "$wt" ] || [ "$url" = "file://$wt" ]; then
          alive=1; break
        fi
      done <<< "$live_worktrees"
    fi

    if [ "$alive" = "0" ]; then
      if git remote remove "$name" 2>/dev/null; then
        log "pruned dead remote $name -> $url"
      fi
    fi
  done < <(git config --local --get-regexp '^remote\.subrepl-.*\.url$' 2>/dev/null)
}

# --- 2. Remove stale .git/index.lock -----------------------------------------
remove_stale_index_lock() {
  local lock="$GIT_DIR/index.lock"
  [ -e "$lock" ] || return 0

  # Bail if any process has the lock open right now.
  if command -v fuser >/dev/null 2>&1; then
    if fuser "$lock" >/dev/null 2>&1; then
      log "index.lock is held by a live process; leaving alone"
      return 0
    fi
  elif command -v lsof >/dev/null 2>&1; then
    if lsof -- "$lock" >/dev/null 2>&1; then
      log "index.lock is held by a live process; leaving alone"
      return 0
    fi
  fi

  # Bail if any live git process has its cwd inside this worktree —
  # it might be about to claim the lock.
  if [ -d /proc ] && command -v pgrep >/dev/null 2>&1; then
    local pid cwd
    while IFS= read -r pid; do
      [ -z "$pid" ] && continue
      cwd="$(readlink "/proc/$pid/cwd" 2>/dev/null)" || continue
      case "$cwd" in
        "$TOPLEVEL"|"$TOPLEVEL"/*)
          log "git pid $pid is rooted in this worktree; leaving lock alone"
          return 0
          ;;
      esac
    done < <(pgrep -x git 2>/dev/null)
  fi

  # Only delete if the lock has been idle for > STALE_LOCK_MINUTES.
  if find "$lock" -mmin +"$STALE_LOCK_MINUTES" -print 2>/dev/null | grep -q .; then
    if rm -f "$lock"; then
      log "removed stale $lock (idle > $STALE_LOCK_MINUTES min)"
    fi
  else
    log "index.lock present but younger than $STALE_LOCK_MINUTES min; leaving alone"
  fi
}

# --- 3. Install pre-push hook (idempotent) -----------------------------------
install_pre_push_hook() {
  local hook="$GIT_DIR/hooks/pre-push"
  mkdir -p "$GIT_DIR/hooks"
  if [ -f "$hook" ] && grep -q 'scripts/git-hygiene.sh' "$hook" 2>/dev/null; then
    return 0
  fi
  cat > "$hook" <<'HOOK'
#!/usr/bin/env bash
# Installed by scripts/git-hygiene.sh. Self-heals before every push.
# Reads (and ignores) the ref list on stdin; never blocks a push.
cat >/dev/null || true
"$(git rev-parse --show-toplevel)/scripts/git-hygiene.sh" </dev/null || true
exit 0
HOOK
  chmod +x "$hook"
  log "installed $hook"
}

prune_dead_subrepl_remotes
remove_stale_index_lock
install_pre_push_hook
