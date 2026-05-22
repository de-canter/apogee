#!/usr/bin/env bash
# apogee-onboard.sh — onboard the current repo onto the shared apogee
# CLAUDE.md (@import) + settings.json sync. Idempotent; safe to re-run.
#
# Usage:
#   cd <repo> && apogee-onboard
#
# Steps:
#   1. Ensure ./CLAUDE.md imports apogee/.claude-shared/CLAUDE.md (path computed
#      relative to this repo, so it works from any location).
#   2. Create .claude/settings.delta.json (the opt-in signal) if absent.
#   3. Add Claude Code per-session state to .gitignore (idempotent).
#   4. Render .claude/settings.json via apogee-sync-settings.
#
# Nothing is committed — the files are left for you to review and commit.

set -euo pipefail

APOGEE_HOME="${APOGEE_HOME:-$HOME/src/github/de-canter/apogee}"
APOGEE_PRODUCTS_ROOT="${APOGEE_PRODUCTS_ROOT:-$HOME/src/github/de-canter}"

if [[ -t 1 ]]; then
  C_RESET=$'\e[0m'; C_DIM=$'\e[2m'; C_BOLD=$'\e[1m'
  C_RED=$'\e[31m'; C_GREEN=$'\e[32m'; C_YELLOW=$'\e[33m'; C_CYAN=$'\e[36m'
else
  C_RESET=''; C_DIM=''; C_BOLD=''; C_RED=''; C_GREEN=''; C_YELLOW=''; C_CYAN=''
fi
ok()   { printf '%s✓%s %s\n' "$C_GREEN" "$C_RESET" "$*"; }
warn() { printf '%s⚠%s %s\n' "$C_YELLOW" "$C_RESET" "$*"; }
err()  { printf '%s✗%s %s\n' "$C_RED" "$C_RESET" "$*" >&2; }
hdr()  { printf '\n%s%s━━ %s ━━%s\n' "$C_BOLD" "$C_CYAN" "$*" "$C_RESET"; }
die()  { err "$*"; exit 1; }

# ----------------------------------------------------------------------------
# Preflight
# ----------------------------------------------------------------------------

command -v jq      >/dev/null 2>&1 || die "missing required command: jq"
command -v python3 >/dev/null 2>&1 || die "missing required command: python3 (computes the @import path)"

[[ -d "$APOGEE_HOME" ]] || die "APOGEE_HOME not found: $APOGEE_HOME"
SHARED_CLAUDE="$APOGEE_HOME/.claude-shared/CLAUDE.md"
[[ -f "$SHARED_CLAUDE" ]] || die "shared CLAUDE.md not found: $SHARED_CLAUDE"
SYNC="$APOGEE_HOME/scripts/apogee-sync-settings.sh"
[[ -f "$SYNC" ]] || die "apogee-sync-settings.sh not found: $SYNC"

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || die "not inside a git repository"
cd "$REPO_ROOT"
NAME="$(basename "$REPO_ROOT")"

# Don't onboard the apogee repo itself.
if [[ "$(pwd -P)" == "$(cd "$APOGEE_HOME" && pwd -P)" ]]; then
  die "refusing to onboard the apogee repo itself"
fi

hdr "Onboarding $NAME"

# ----------------------------------------------------------------------------
# 1. CLAUDE.md @import
# ----------------------------------------------------------------------------

IMPORT_TARGET="$(python3 -c 'import os,sys; print(os.path.relpath(sys.argv[1], sys.argv[2]))' "$SHARED_CLAUDE" "$REPO_ROOT")"
IMPORT_LINE="@${IMPORT_TARGET}"

if [[ -f CLAUDE.md ]]; then
  if grep -qF "apogee/.claude-shared/CLAUDE.md" CLAUDE.md; then
    ok "CLAUDE.md already imports the apogee baseline"
  else
    tmp="$(mktemp)"
    if [[ "$(head -1 CLAUDE.md)" == \#\ * ]]; then
      # Insert the import just after the first heading.
      { head -1 CLAUDE.md; printf '\n%s\n' "$IMPORT_LINE"; tail -n +2 CLAUDE.md; } > "$tmp"
    else
      { printf '%s\n\n' "$IMPORT_LINE"; cat CLAUDE.md; } > "$tmp"
    fi
    mv "$tmp" CLAUDE.md
    ok "added import to existing CLAUDE.md: $IMPORT_LINE"
  fi
else
  {
    printf '# %s — Claude Code Context\n\n' "$NAME"
    printf '%s\n' "$IMPORT_LINE"
    [[ -f SPEC.md ]] && printf '@./SPEC.md\n'
  } > CLAUDE.md
  ok "created CLAUDE.md with apogee import ($IMPORT_LINE)"
fi

# ----------------------------------------------------------------------------
# 2. settings.delta.json (opt-in signal)
# ----------------------------------------------------------------------------

mkdir -p .claude
if [[ -f .claude/settings.delta.json ]]; then
  jq empty .claude/settings.delta.json 2>/dev/null \
    || die ".claude/settings.delta.json exists but is not valid JSON — fix it before onboarding"
  ok ".claude/settings.delta.json already present"
else
  # Static, trusted content — quoted heredoc, no interpolation.
  cat > .claude/settings.delta.json <<'JSON'
{
  "permissions": {
    "allow": [],
    "deny": []
  }
}
JSON
  ok "created .claude/settings.delta.json (add product-specific allow/deny here)"
fi

# ----------------------------------------------------------------------------
# 3. .gitignore — per-session harness state
# ----------------------------------------------------------------------------

ensure_gitignore_entry() {
  local entry="$1"
  if [[ -f .gitignore ]] && grep -qxF "$entry" .gitignore; then
    return
  fi
  if ! grep -qF "Claude Code per-session harness state" .gitignore 2>/dev/null; then
    printf '\n# Claude Code per-session harness state (managed by apogee; not source)\n' >> .gitignore
  fi
  printf '%s\n' "$entry" >> .gitignore
}
for entry in \
  ".claude/status.json" \
  ".claude/WATCHDOG_TIMEOUT" \
  ".claude/settings.local.json" \
  "BLOCKED.md"; do
  ensure_gitignore_entry "$entry"
done
ok "ensured .gitignore covers per-session state"

# ----------------------------------------------------------------------------
# 4. Render the composite settings.json
# ----------------------------------------------------------------------------

hdr "Rendering settings"
bash "$SYNC"

# ----------------------------------------------------------------------------
# Wrap-up
# ----------------------------------------------------------------------------

# Heads-up if this repo lives outside the tree apogee-sync-all scans.
case "$REPO_ROOT/" in
  "$APOGEE_PRODUCTS_ROOT"/*) : ;;
  *) warn "this repo is outside APOGEE_PRODUCTS_ROOT ($APOGEE_PRODUCTS_ROOT) — 'apogee-sync-all' won't include it; re-run 'apogee-sync-settings' here after baseline changes" ;;
esac

hdr "Done — review and commit"
cat <<EOF
Onboarded ${C_BOLD}${NAME}${C_RESET}. Review then commit:

  git add CLAUDE.md .claude/settings.delta.json .claude/settings.json .gitignore
  git commit -m "chore: onboard onto apogee shared CLAUDE.md + settings sync"

Next: edit .claude/settings.delta.json for product-specific rules and re-run
apogee-sync-settings. CLAUDE.md changes need no sync (live @import).
EOF
