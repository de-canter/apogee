#!/usr/bin/env bash
# apogee-resume.sh — review or resume an autonomous Claude Code session.
#
# Usage:
#   apogee-resume.sh                          # list recent sessions, pick one
#   apogee-resume.sh <product> <task-slug>    # jump straight to a session
#   apogee-resume.sh --latest                 # most recent session
#
# What it shows you:
#   • Session metadata (when started, how long ran, why it stopped)
#   • status.json snapshot (current phase, tasks completed, what's next)
#   • BLOCKED.md if Claude got stuck
#   • Watchdog timeout if the max-duration killed it
#   • Commit log on the autonomous branch
#   • Test status (typecheck / lint / tests)
#   • Diff summary (files changed, +/- counts)
#
# What you can do from the menu:
#   [r] Resume — relaunch Claude Code in the same worktree to continue
#   [d] Show full diff in $PAGER
#   [m] Merge — fast-forward or merge the branch into the source branch
#   [p] Open PR via gh (push + create PR for review)
#   [x] Discard — remove worktree and delete branch (asks twice)
#   [s] Shell — drop into the worktree to poke around
#   [q] Quit (default; leaves worktree untouched)

set -euo pipefail

# ----------------------------------------------------------------------------
# Configuration
# ----------------------------------------------------------------------------

APOGEE_PRODUCTS_ROOT="${APOGEE_PRODUCTS_ROOT:-$HOME/src/github/de-canter}"
AUTONOMOUS_ROOT="${AUTONOMOUS_ROOT:-$HOME/work/autonomous}"
LOG_DIR="$AUTONOMOUS_ROOT/logs"
CLAUDE_BIN="${CLAUDE_BIN:-claude}"
PAGER="${PAGER:-less -R}"

# ----------------------------------------------------------------------------
# Pretty output
# ----------------------------------------------------------------------------

if [[ -t 1 ]]; then
  C_RESET=$'\e[0m'; C_DIM=$'\e[2m'; C_BOLD=$'\e[1m'
  C_RED=$'\e[31m'; C_GREEN=$'\e[32m'; C_YELLOW=$'\e[33m'
  C_BLUE=$'\e[34m'; C_CYAN=$'\e[36m'; C_MAGENTA=$'\e[35m'
else
  C_RESET=''; C_DIM=''; C_BOLD=''; C_RED=''; C_GREEN=''
  C_YELLOW=''; C_BLUE=''; C_CYAN=''; C_MAGENTA=''
fi

ok()   { printf '%s✓%s %s\n' "$C_GREEN" "$C_RESET" "$*"; }
warn() { printf '%s⚠%s %s\n' "$C_YELLOW" "$C_RESET" "$*"; }
err()  { printf '%s✗%s %s\n' "$C_RED" "$C_RESET" "$*" >&2; }
hdr()  { printf '\n%s%s━━ %s ━━%s\n' "$C_BOLD" "$C_CYAN" "$*" "$C_RESET"; }
die()  { err "$*"; exit 1; }

# ----------------------------------------------------------------------------
# Session discovery
# ----------------------------------------------------------------------------

list_sessions() {
  # Find all worktree dirs under AUTONOMOUS_ROOT that have a .claude/status.json
  find "$AUTONOMOUS_ROOT" -maxdepth 2 -type f -path '*/.claude/status.json' 2>/dev/null \
    | while read -r status_path; do
        wt="$(dirname "$(dirname "$status_path")")"
        printf '%s\n' "$wt"
      done \
    | sort -r
}

session_summary() {
  local wt="$1"
  local status="$wt/.claude/status.json"
  if [[ ! -f "$status" ]]; then
    echo "(no status.json) $(basename "$wt")"
    return
  fi
  local product slug phase started
  product="$(jq -r '.product // "?"' "$status")"
  slug="$(jq -r '.task_slug // "?"' "$status")"
  phase="$(jq -r '.phase // "?"' "$status")"
  started="$(jq -r '.started_at // "?"' "$status")"
  local blocked=""
  [[ -f "$wt/BLOCKED.md" ]] && blocked=" ${C_YELLOW}[BLOCKED]${C_RESET}"
  local timeout=""
  [[ -f "$wt/.claude/WATCHDOG_TIMEOUT" ]] && timeout=" ${C_RED}[TIMEOUT]${C_RESET}"
  printf '%s%s/%s%s  %s%s%s%s%s\n' \
    "$C_BOLD" "$product" "$slug" "$C_RESET" \
    "$C_DIM" "$started · phase=$phase" "$C_RESET" "$blocked" "$timeout"
}

pick_session_interactive() {
  hdr "Recent autonomous sessions"
  local i=0
  declare -ga SESSIONS=()
  while IFS= read -r wt; do
    SESSIONS+=("$wt")
    i=$((i+1))
    printf '  %s[%d]%s ' "$C_CYAN" "$i" "$C_RESET"
    session_summary "$wt"
  done < <(list_sessions)

  if [[ ${#SESSIONS[@]} -eq 0 ]]; then
    die "no sessions found under $AUTONOMOUS_ROOT"
  fi

  echo
  read -r -p "Pick session [1-${#SESSIONS[@]}], or q to quit: " choice
  [[ "$choice" =~ ^[Qq]$ ]] && exit 0
  if [[ ! "$choice" =~ ^[0-9]+$ ]] || (( choice < 1 || choice > ${#SESSIONS[@]} )); then
    die "invalid selection"
  fi
  WORKTREE="${SESSIONS[$((choice-1))]}"
}

# ----------------------------------------------------------------------------
# Argument parsing
# ----------------------------------------------------------------------------

WORKTREE=""

if [[ $# -eq 0 ]]; then
  pick_session_interactive
elif [[ "$1" == "--latest" || "$1" == "-l" ]]; then
  WORKTREE="$(list_sessions | head -n1)"
  [[ -n "$WORKTREE" ]] || die "no sessions found"
elif [[ $# -eq 2 ]]; then
  PRODUCT="$1"
  TASK_SLUG="$2"
  # Find the most recent worktree matching this product+slug
  WORKTREE="$(find "$AUTONOMOUS_ROOT" -maxdepth 1 -type d \
    -name "${PRODUCT}-${TASK_SLUG}-*" 2>/dev/null | sort -r | head -n1)"
  [[ -n "$WORKTREE" ]] || die "no worktree found for $PRODUCT/$TASK_SLUG"
else
  cat <<EOF
${C_BOLD}apogee-resume${C_RESET} — review or resume an autonomous Claude Code session

${C_BOLD}Usage:${C_RESET}
  apogee-resume.sh                       # interactive picker
  apogee-resume.sh <product> <task-slug> # specific session
  apogee-resume.sh --latest              # most recent
EOF
  exit 1
fi

[[ -d "$WORKTREE" ]] || die "worktree not found: $WORKTREE"
[[ -f "$WORKTREE/.claude/status.json" ]] || die "not a managed session: $WORKTREE"

# Derive context
STATUS_FILE="$WORKTREE/.claude/status.json"
PRODUCT="$(jq -r '.product' "$STATUS_FILE")"
TASK_SLUG="$(jq -r '.task_slug' "$STATUS_FILE")"
BRANCH="$(jq -r '.branch' "$STATUS_FILE")"
SESSION_ID="$(jq -r '.session_id' "$STATUS_FILE")"
PRODUCT_REPO="$APOGEE_PRODUCTS_ROOT/$PRODUCT"

# ----------------------------------------------------------------------------
# Render the digest
# ----------------------------------------------------------------------------

clear

hdr "Session digest"
printf '%sProduct:%s   %s\n'  "$C_BOLD" "$C_RESET" "$PRODUCT"
printf '%sTask:%s      %s\n'  "$C_BOLD" "$C_RESET" "$TASK_SLUG"
printf '%sBranch:%s    %s\n'  "$C_BOLD" "$C_RESET" "$BRANCH"
printf '%sWorktree:%s  %s\n'  "$C_BOLD" "$C_RESET" "$WORKTREE"
printf '%sSession:%s   %s\n'  "$C_BOLD" "$C_RESET" "$SESSION_ID"

STARTED="$(jq -r '.started_at' "$STATUS_FILE")"
LAST_CHECKPOINT="$(jq -r '.last_checkpoint' "$STATUS_FILE")"
PHASE="$(jq -r '.phase' "$STATUS_FILE")"
printf '%sStarted:%s   %s\n'  "$C_BOLD" "$C_RESET" "$STARTED"
printf '%sLast ck:%s   %s\n'  "$C_BOLD" "$C_RESET" "$LAST_CHECKPOINT"

PHASE_COLOR="$C_DIM"
case "$PHASE" in
  blocked)  PHASE_COLOR="$C_RED" ;;
  complete) PHASE_COLOR="$C_GREEN" ;;
  idle)     PHASE_COLOR="$C_YELLOW" ;;
  implementation|validation|planning) PHASE_COLOR="$C_BLUE" ;;
esac
printf '%sPhase:%s     %s%s%s\n' \
  "$C_BOLD" "$C_RESET" "$PHASE_COLOR" "$PHASE" "$C_RESET"

# Watchdog timeout?
if [[ -f "$WORKTREE/.claude/WATCHDOG_TIMEOUT" ]]; then
  hdr "${C_RED}Watchdog timeout${C_RESET}"
  cat "$WORKTREE/.claude/WATCHDOG_TIMEOUT"
fi

# Blocked?
if [[ -f "$WORKTREE/BLOCKED.md" ]]; then
  hdr "${C_YELLOW}BLOCKED.md${C_RESET}"
  cat "$WORKTREE/BLOCKED.md"
fi

# Test status
hdr "Test status"
jq -r '.tests_status | "  typecheck: \(.typecheck // "unknown")\n  lint:      \(.lint // "unknown")\n  tests:     \(.tests // "unknown")"' "$STATUS_FILE"

# Completed tasks
hdr "Completed tasks"
COMPLETED_COUNT="$(jq -r '.completed_tasks | length' "$STATUS_FILE")"
if [[ "$COMPLETED_COUNT" -eq 0 ]]; then
  printf '%s  (none)%s\n' "$C_DIM" "$C_RESET"
else
  jq -r '.completed_tasks[] | "  ✓ \(.)"' "$STATUS_FILE"
fi

# Next planned
NEXT_PLANNED="$(jq -r '.next_planned // empty' "$STATUS_FILE")"
if [[ -n "$NEXT_PLANNED" ]]; then
  hdr "Next planned"
  printf '  %s\n' "$NEXT_PLANNED"
fi

# Commit log
hdr "Commits on $BRANCH"
COMMITS_AHEAD="$(git -C "$WORKTREE" rev-list --count "@{u}..HEAD" 2>/dev/null || \
                 git -C "$WORKTREE" rev-list --count "HEAD" --not \
                   "$(git -C "$WORKTREE" merge-base HEAD main 2>/dev/null || \
                      git -C "$WORKTREE" merge-base HEAD master 2>/dev/null || \
                      echo HEAD)" 2>/dev/null || echo "?")"
if [[ "$COMMITS_AHEAD" == "0" || "$COMMITS_AHEAD" == "?" ]]; then
  printf '%s  (no commits yet, or could not determine base)%s\n' "$C_DIM" "$C_RESET"
else
  git -C "$WORKTREE" log --oneline -n 20 --color=always \
    "$(git -C "$WORKTREE" merge-base HEAD main 2>/dev/null || \
       git -C "$WORKTREE" merge-base HEAD master 2>/dev/null || echo HEAD~20)..HEAD"
fi

# Diff summary
hdr "Diff summary (vs merge-base)"
BASE="$(git -C "$WORKTREE" merge-base HEAD main 2>/dev/null || \
        git -C "$WORKTREE" merge-base HEAD master 2>/dev/null || echo "")"
if [[ -n "$BASE" ]]; then
  git -C "$WORKTREE" diff --stat "$BASE..HEAD" 2>/dev/null | tail -n 20 || \
    printf '%s  (no diff)%s\n' "$C_DIM" "$C_RESET"
else
  printf '%s  (could not determine base branch)%s\n' "$C_DIM" "$C_RESET"
fi

# Uncommitted changes in the worktree?
if [[ -n "$(git -C "$WORKTREE" status --porcelain 2>/dev/null)" ]]; then
  hdr "${C_YELLOW}Uncommitted changes in worktree${C_RESET}"
  git -C "$WORKTREE" status --short
fi

# ----------------------------------------------------------------------------
# Interactive action menu
# ----------------------------------------------------------------------------

action_resume() {
  hdr "Resuming session in worktree"
  cd "$WORKTREE"
  local resume_log="$LOG_DIR/${PRODUCT}-${TASK_SLUG}-resume-$(date +%Y%m%d-%H%M%S).log"
  mkdir -p "$LOG_DIR"
  cat <<EOF | "$CLAUDE_BIN" --permission-mode auto 2>&1 | tee "$resume_log"
You are resuming an autonomous Claude Code session.

Read .claude/status.json, BLOCKED.md (if present), and the most recent
commits on this branch to reorient. Then proceed.

If BLOCKED.md exists, address the block first — either by taking one of
the documented options, or by writing an updated BLOCKED.md if still stuck.

Same autonomy rules from CLAUDE.md apply.
EOF
}

action_diff() {
  local base
  base="$(git -C "$WORKTREE" merge-base HEAD main 2>/dev/null || \
          git -C "$WORKTREE" merge-base HEAD master 2>/dev/null || echo "")"
  if [[ -z "$base" ]]; then
    warn "could not determine base branch"
    return
  fi
  git -C "$WORKTREE" diff --color=always "$base..HEAD" | $PAGER
}

action_merge() {
  hdr "Merge $BRANCH into source branch"
  # The product repo's current branch is the merge target
  local target
  target="$(git -C "$PRODUCT_REPO" rev-parse --abbrev-ref HEAD)"
  printf 'Target branch (in %s): %s%s%s\n' "$PRODUCT_REPO" "$C_BOLD" "$target" "$C_RESET"
  read -r -p "Merge $BRANCH into $target? [y/N] " confirm
  [[ "$confirm" =~ ^[Yy]$ ]] || { warn "merge cancelled"; return; }

  # Try fast-forward first, fall back to a real merge
  if git -C "$PRODUCT_REPO" merge --ff-only "$BRANCH" 2>/dev/null; then
    ok "fast-forward merge succeeded"
  else
    warn "fast-forward not possible — performing merge commit"
    git -C "$PRODUCT_REPO" merge --no-ff "$BRANCH" \
      -m "Merge autonomous session $SESSION_ID: $TASK_SLUG"
    ok "merge commit created"
  fi
}

action_pr() {
  hdr "Push and open PR"
  read -r -p "Push $BRANCH and open PR? [y/N] " confirm
  [[ "$confirm" =~ ^[Yy]$ ]] || { warn "PR creation cancelled"; return; }
  git -C "$WORKTREE" push -u origin "$BRANCH"
  cd "$WORKTREE"
  gh pr create --fill --draft \
    --title "[autonomous] $TASK_SLUG" \
    --body "$(cat <<EOF
Autonomous session $SESSION_ID

**Product:** $PRODUCT
**Task:** $TASK_SLUG
**Branch:** $BRANCH

See .claude/status.json in the branch for session details.
EOF
)"
}

action_discard() {
  hdr "${C_RED}Discard worktree and branch${C_RESET}"
  printf 'This will:\n'
  printf '  • Remove worktree:  %s\n' "$WORKTREE"
  printf '  • Delete branch:    %s\n' "$BRANCH"
  printf '  • Lose any uncommitted changes\n\n'
  read -r -p "Are you sure? Type the task-slug to confirm: " confirm
  if [[ "$confirm" != "$TASK_SLUG" ]]; then
    warn "discard cancelled (slug did not match)"
    return
  fi
  git -C "$PRODUCT_REPO" worktree remove --force "$WORKTREE"
  git -C "$PRODUCT_REPO" branch -D "$BRANCH" 2>/dev/null || \
    warn "branch deletion skipped (may have been merged)"
  ok "discarded"
  exit 0
}

action_shell() {
  hdr "Dropping into worktree shell"
  printf '%sType "exit" to return to the resume menu.%s\n' "$C_DIM" "$C_RESET"
  cd "$WORKTREE"
  ${SHELL:-bash} || true
}

while true; do
  hdr "Actions"
  cat <<EOF
  ${C_CYAN}[r]${C_RESET} Resume — relaunch Claude Code to continue
  ${C_CYAN}[d]${C_RESET} Diff — view full diff in pager
  ${C_CYAN}[m]${C_RESET} Merge — fast-forward or merge into source branch
  ${C_CYAN}[p]${C_RESET} PR — push branch and open draft PR
  ${C_CYAN}[s]${C_RESET} Shell — drop into worktree
  ${C_CYAN}[x]${C_RESET} Discard — remove worktree and branch
  ${C_CYAN}[q]${C_RESET} Quit (leaves everything as-is)
EOF
  read -r -p "Choose: " action
  case "$action" in
    r|R) action_resume ;;
    d|D) action_diff ;;
    m|M) action_merge ;;
    p|P) action_pr ;;
    s|S) action_shell ;;
    x|X) action_discard ;;
    q|Q|"") exit 0 ;;
    *) warn "unknown action: $action" ;;
  esac
done
