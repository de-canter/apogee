#!/usr/bin/env bash
# apogee-autonomous.sh — launch an autonomous Claude Code session in an
# isolated git worktree.
#
# Usage:
#   apogee-autonomous.sh <product-repo> <task-slug> [spec-file]
#
# Examples:
#   apogee-autonomous.sh somm photo-capture-flow
#   apogee-autonomous.sh nailnotes decisions-feature docs/specs/decisions.md
#   apogee-autonomous.sh thesomm qa-agent-phase2 docs/specs/qa-phase2.md
#
# What it does:
#   1. Validates the product repo exists and is git-clean enough
#   2. Creates a worktree at $AUTONOMOUS_ROOT/<product>-<slug>-<date>
#      on a new branch autonomous/<date>-<slug>
#   3. Wires up .claude/ (settings, status, commands, agents)
#   4. Builds the initial prompt (points Claude at CLAUDE.md, SPEC.md, task spec)
#   5. Launches Claude Code in auto mode with logging
#   6. Starts a watchdog that kills the session after MAX_SESSION_HOURS
#
# Cleanup:
#   The worktree is NOT auto-deleted. You decide post-hoc:
#     - Merge the branch (apogee-resume.sh handles review/merge)
#     - Discard with: git worktree remove <path> && git branch -D <branch>

set -euo pipefail

# ----------------------------------------------------------------------------
# Configuration (overridable via env)
# ----------------------------------------------------------------------------

APOGEE_HOME="${APOGEE_HOME:-$HOME/src/github/de-canter/apogee}"
APOGEE_PRODUCTS_ROOT="${APOGEE_PRODUCTS_ROOT:-$HOME/src/github/de-canter}"
AUTONOMOUS_ROOT="${AUTONOMOUS_ROOT:-$HOME/work/autonomous}"
SHARED_CLAUDE_DIR="${SHARED_CLAUDE_DIR:-$APOGEE_HOME/.claude-shared}"
LOG_DIR="$AUTONOMOUS_ROOT/logs"
MAX_SESSION_HOURS="${MAX_SESSION_HOURS:-8}"
CLAUDE_BIN="${CLAUDE_BIN:-claude}"

# ----------------------------------------------------------------------------
# Pretty output
# ----------------------------------------------------------------------------

if [[ -t 1 ]]; then
  C_RESET=$'\e[0m'; C_DIM=$'\e[2m'; C_BOLD=$'\e[1m'
  C_RED=$'\e[31m'; C_GREEN=$'\e[32m'; C_YELLOW=$'\e[33m'
  C_BLUE=$'\e[34m'; C_CYAN=$'\e[36m'
else
  C_RESET=''; C_DIM=''; C_BOLD=''; C_RED=''; C_GREEN=''
  C_YELLOW=''; C_BLUE=''; C_CYAN=''
fi

log()  { printf '%s[%s]%s %s\n' "$C_DIM" "$(date +%H:%M:%S)" "$C_RESET" "$*"; }
ok()   { printf '%s✓%s %s\n' "$C_GREEN" "$C_RESET" "$*"; }
warn() { printf '%s⚠%s %s\n' "$C_YELLOW" "$C_RESET" "$*"; }
err()  { printf '%s✗%s %s\n' "$C_RED" "$C_RESET" "$*" >&2; }
hdr()  { printf '\n%s%s━━ %s ━━%s\n' "$C_BOLD" "$C_CYAN" "$*" "$C_RESET"; }
die()  { err "$*"; exit 1; }

# ----------------------------------------------------------------------------
# Argument parsing
# ----------------------------------------------------------------------------

if [[ $# -lt 2 || $# -gt 3 ]]; then
  cat <<EOF
${C_BOLD}apogee-autonomous${C_RESET} — launch a Claude Code session in an isolated worktree

${C_BOLD}Usage:${C_RESET}
  apogee-autonomous.sh <product-repo> <task-slug> [spec-file]

${C_BOLD}Examples:${C_RESET}
  apogee-autonomous.sh somm photo-capture-flow
  apogee-autonomous.sh nailnotes decisions-feature docs/specs/decisions.md

${C_BOLD}Environment overrides:${C_RESET}
  APOGEE_HOME            (${APOGEE_HOME})
  APOGEE_PRODUCTS_ROOT   (${APOGEE_PRODUCTS_ROOT})
  AUTONOMOUS_ROOT        (${AUTONOMOUS_ROOT})
  MAX_SESSION_HOURS      (${MAX_SESSION_HOURS})
EOF
  exit 1
fi

PRODUCT="$1"
TASK_SLUG="$2"
SPEC_FILE="${3:-}"

# Validate task slug — kebab-case, no path tricks
if [[ ! "$TASK_SLUG" =~ ^[a-z0-9][a-z0-9-]{1,60}$ ]]; then
  die "task-slug must be kebab-case, 2-60 chars: '$TASK_SLUG'"
fi

PRODUCT_REPO="$APOGEE_PRODUCTS_ROOT/$PRODUCT"
TODAY="$(date +%Y-%m-%d)"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
BRANCH="autonomous/${TODAY}-${TASK_SLUG}"
WORKTREE="$AUTONOMOUS_ROOT/${PRODUCT}-${TASK_SLUG}-${TODAY}"
LOG_FILE="$LOG_DIR/${PRODUCT}-${TASK_SLUG}-${TIMESTAMP}.log"
STATUS_FILE="$WORKTREE/.claude/status.json"

# ----------------------------------------------------------------------------
# Preflight checks
# ----------------------------------------------------------------------------

hdr "Preflight"

for cmd in git "$CLAUDE_BIN" jq; do
  command -v "$cmd" >/dev/null 2>&1 || die "missing required command: $cmd"
done
ok "required commands present"

[[ -d "$APOGEE_HOME" ]]        || die "APOGEE_HOME not found: $APOGEE_HOME"
[[ -d "$SHARED_CLAUDE_DIR" ]]  || die "shared .claude dir not found: $SHARED_CLAUDE_DIR"
[[ -d "$PRODUCT_REPO" ]]       || die "product repo not found: $PRODUCT_REPO"
[[ -d "$PRODUCT_REPO/.git" ]]  || die "product repo is not a git repo: $PRODUCT_REPO"
ok "apogee, shared config, and product repo found"

# Shared settings-composition routine (same one apogee-sync-settings.sh uses,
# so the launcher and the sync command can never drift out of sync).
COMPOSE_LIB="$APOGEE_HOME/scripts/_compose-settings.sh"
[[ -f "$COMPOSE_LIB" ]] || die "compose library not found: $COMPOSE_LIB"
# shellcheck source=/dev/null
source "$COMPOSE_LIB"
ok "loaded shared compose routine"

[[ ! -e "$WORKTREE" ]] || die "worktree path already exists: $WORKTREE"

if git -C "$PRODUCT_REPO" show-ref --verify --quiet "refs/heads/$BRANCH"; then
  die "branch already exists: $BRANCH (pick a different task-slug or delete it)"
fi

if [[ -n "$(git -C "$PRODUCT_REPO" status --porcelain)" ]]; then
  warn "product repo has uncommitted changes — worktree branches from HEAD"
  warn "  (your uncommitted work stays in $PRODUCT_REPO, untouched)"
fi
ok "product repo state acceptable"

if [[ -n "$SPEC_FILE" ]]; then
  [[ -f "$PRODUCT_REPO/$SPEC_FILE" ]] || die "spec file not found: $PRODUCT_REPO/$SPEC_FILE"
  ok "spec file present: $SPEC_FILE"
fi

mkdir -p "$AUTONOMOUS_ROOT" "$LOG_DIR"

# ----------------------------------------------------------------------------
# Create the worktree
# ----------------------------------------------------------------------------

hdr "Worktree setup"

log "creating worktree: $WORKTREE"
log "  branch: $BRANCH"
log "  base:   $(git -C "$PRODUCT_REPO" rev-parse --abbrev-ref HEAD)"

git -C "$PRODUCT_REPO" worktree add -b "$BRANCH" "$WORKTREE" >/dev/null
ok "worktree created"

# ----------------------------------------------------------------------------
# Wire up .claude/
# ----------------------------------------------------------------------------

hdr "Claude config"

mkdir -p "$WORKTREE/.claude"

# Compose the worktree's effective project settings from the apogee Verve
# baseline plus the product's committed delta (.claude/settings.delta.json),
# using the SAME shared routine as apogee-sync-settings.sh. The personal layer
# (~/.claude/settings.json) is loaded separately by Claude Code as the user
# layer — it is NOT part of this merge.
BASELINE_SETTINGS="$SHARED_CLAUDE_DIR/settings.json"
PRODUCT_SETTINGS="$WORKTREE/.claude/settings.json"
PRODUCT_DELTA="$WORKTREE/.claude/settings.delta.json"

# Was settings.json git-tracked before we (re)render it? (Per convention the
# product commits the composite, so it usually is.) We hide our overwrite so
# the autonomous session never commits a freshly-composed copy back.
SETTINGS_TRACKED=0
if git -C "$WORKTREE" ls-files --error-unmatch .claude/settings.json >/dev/null 2>&1; then
  SETTINGS_TRACKED=1
fi

if [[ -f "$PRODUCT_DELTA" ]]; then
  apogee_compose_settings "$BASELINE_SETTINGS" "$PRODUCT_DELTA" "$PRODUCT_SETTINGS" "$APOGEE_SETTINGS_BANNER" \
    || die "failed to compose settings"
  ok "composed apogee baseline ⊔ product delta (.claude/settings.delta.json)"
else
  apogee_compose_settings "$BASELINE_SETTINGS" "" "$PRODUCT_SETTINGS" "$APOGEE_SETTINGS_BANNER" \
    || die "failed to compose settings"
  ok "installed apogee baseline (no product delta)"
fi
ok "wrote .claude/settings.json (deny entries: $(jq '.permissions.deny | length' "$PRODUCT_SETTINGS"))"

if [[ "$SETTINGS_TRACKED" -eq 1 ]]; then
  git -C "$WORKTREE" update-index --skip-worktree .claude/settings.json
  ok "marked .claude/settings.json skip-worktree (won't be committed)"
fi

# Symlink shared commands/agents if present (additive — won't clobber repo's)
for sub in commands agents; do
  if [[ -d "$SHARED_CLAUDE_DIR/$sub" && ! -e "$WORKTREE/.claude/$sub" ]]; then
    ln -s "$SHARED_CLAUDE_DIR/$sub" "$WORKTREE/.claude/$sub"
    ok "symlinked $sub/"
  fi
done

# ----------------------------------------------------------------------------
# Initialize status.json
# ----------------------------------------------------------------------------

jq -n \
  --arg session "$TIMESTAMP" \
  --arg product "$PRODUCT" \
  --arg slug "$TASK_SLUG" \
  --arg branch "$BRANCH" \
  --arg worktree "$WORKTREE" \
  --arg now "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  '{
    session_id: $session,
    product: $product,
    task_slug: $slug,
    branch: $branch,
    worktree: $worktree,
    started_at: $now,
    current_task: "session starting",
    phase: "planning",
    last_checkpoint: $now,
    completed_tasks: [],
    blocked_tasks: [],
    tests_status: {
      typecheck: "unknown",
      lint: "unknown",
      tests: "unknown"
    },
    next_planned: null
  }' > "$STATUS_FILE"
ok "initialized status.json"

# ----------------------------------------------------------------------------
# Build the initial prompt
# ----------------------------------------------------------------------------

hdr "Building prompt"

INITIAL_PROMPT_FILE="$(mktemp)"

cat > "$INITIAL_PROMPT_FILE" <<EOF
You are starting an autonomous Claude Code session.

SESSION CONTEXT
- Product: $PRODUCT
- Task: $TASK_SLUG
- Branch: $BRANCH
- Worktree: $WORKTREE (you are here)
- Max session duration: ${MAX_SESSION_HOURS} hours
- Session ID: $TIMESTAMP

BEFORE WRITING ANY CODE, read in this order:
1. ./CLAUDE.md   (product-specific rules; imports the apogee autonomy contract)
2. ./SPEC.md     (if present — the locked product spec)
EOF

if [[ -n "$SPEC_FILE" ]]; then
  cat >> "$INITIAL_PROMPT_FILE" <<EOF
3. ./$SPEC_FILE  (the specific spec for THIS task)
EOF
fi

cat >> "$INITIAL_PROMPT_FILE" <<EOF

THEN, before any implementation:
- Enter Plan Mode and produce a task breakdown
- Update .claude/status.json — fill in completed_tasks (empty), next_planned
- Commit the planning state with message "chore: session $TIMESTAMP planning"
- Exit Plan Mode and begin execution

REMEMBER
- You are running unattended. Apply the 2am test from CLAUDE.md.
- Update .claude/status.json at every checkpoint. ARGUS reads it.
- If genuinely blocked, write BLOCKED.md and move to the next task.
- Commit at every logical checkpoint, not at the end of the session.
- Never push. Pushing is a human decision.
- Run typecheck + lint + tests before declaring any task done.

Begin.
EOF

ok "prompt prepared ($(wc -l < "$INITIAL_PROMPT_FILE" | tr -d ' ') lines)"

# ----------------------------------------------------------------------------
# Launch summary
# ----------------------------------------------------------------------------

hdr "Launch summary"

cat <<EOF
${C_BOLD}Session:${C_RESET}    $TIMESTAMP
${C_BOLD}Product:${C_RESET}    $PRODUCT
${C_BOLD}Task:${C_RESET}       $TASK_SLUG
${C_BOLD}Branch:${C_RESET}     $BRANCH
${C_BOLD}Worktree:${C_RESET}   $WORKTREE
${C_BOLD}Log:${C_RESET}        $LOG_FILE
${C_BOLD}Status:${C_RESET}     $STATUS_FILE
${C_BOLD}Max hours:${C_RESET}  $MAX_SESSION_HOURS

${C_DIM}To monitor:${C_RESET}
  tail -f $LOG_FILE
  watch -n 5 'jq . $STATUS_FILE'

${C_DIM}To stop early:${C_RESET}
  Ctrl-C, or: pkill -f "claude.*$TIMESTAMP"

${C_DIM}To resume / review tomorrow:${C_RESET}
  apogee-resume.sh $PRODUCT $TASK_SLUG

EOF

# ----------------------------------------------------------------------------
# Watchdog (max duration enforcement)
# ----------------------------------------------------------------------------

(
  sleep "$((MAX_SESSION_HOURS * 3600))"
  echo "max session duration reached at $(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    > "$WORKTREE/.claude/WATCHDOG_TIMEOUT"
  pkill -TERM -f "claude.*$TIMESTAMP" 2>/dev/null || true
) &
WATCHDOG_PID=$!
log "watchdog started (PID $WATCHDOG_PID, fires after ${MAX_SESSION_HOURS}h)"

# Clean up watchdog and tempfile on exit, no matter how
trap 'kill $WATCHDOG_PID 2>/dev/null || true; rm -f "$INITIAL_PROMPT_FILE"' EXIT

# ----------------------------------------------------------------------------
# Launch Claude Code
# ----------------------------------------------------------------------------

hdr "Launching Claude Code"

cd "$WORKTREE"

# The session ID is appended to the system prompt so the watchdog
# can identify and signal this specific process via pkill.
"$CLAUDE_BIN" \
  --permission-mode auto \
  --append-system-prompt "Session ID: $TIMESTAMP" \
  < "$INITIAL_PROMPT_FILE" \
  2>&1 | tee "$LOG_FILE"
