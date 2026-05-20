#!/usr/bin/env bash
# apogee-sync-settings.sh — render a product's committed .claude/settings.json
# from the apogee Verve baseline plus the product's .claude/settings.delta.json.
#
# Run this from inside a product repo (no arguments):
#   cd ~/src/github/de-canter/thesomm && apogee-sync-settings
#
# Convention:
#   .claude/settings.delta.json   product's additions ONLY (you edit this)
#   .claude/settings.json         generated composite (DO NOT edit by hand)
#
# Both are committed. Re-run after editing the delta, or after the apogee
# baseline changes, to regenerate the composite. apogee-sync-all does this
# across every product at once.

set -euo pipefail

APOGEE_HOME="${APOGEE_HOME:-$HOME/src/github/de-canter/apogee}"

# ----------------------------------------------------------------------------
# Pretty output
# ----------------------------------------------------------------------------

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
# Locate apogee and the shared compose routine
# ----------------------------------------------------------------------------

command -v jq >/dev/null 2>&1 || die "missing required command: jq"

[[ -d "$APOGEE_HOME" ]] || die "APOGEE_HOME not found: $APOGEE_HOME"
BASELINE="$APOGEE_HOME/.claude-shared/settings.json"
[[ -f "$BASELINE" ]] || die "apogee baseline not found: $BASELINE"

COMPOSE_LIB="$APOGEE_HOME/scripts/_compose-settings.sh"
[[ -f "$COMPOSE_LIB" ]] || die "compose library not found: $COMPOSE_LIB"
# shellcheck source=/dev/null
source "$COMPOSE_LIB"

# ----------------------------------------------------------------------------
# Compose
# ----------------------------------------------------------------------------

DELTA=".claude/settings.delta.json"
TARGET=".claude/settings.json"

mkdir -p .claude

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

if [[ -f "$DELTA" ]]; then
  apogee_compose_settings "$BASELINE" "$DELTA" "$TMP" "$APOGEE_SETTINGS_BANNER" \
    || die "composition failed"
  ok "composed baseline ⊔ $DELTA"
else
  apogee_compose_settings "$BASELINE" "" "$TMP" "$APOGEE_SETTINGS_BANNER" \
    || die "composition failed"
  warn "no $DELTA found — rendered baseline only (create one to add product-specific rules)"
fi

ok "valid JSON · deny entries: $(jq '.permissions.deny | length' "$TMP") · allow entries: $(jq '.permissions.allow | length' "$TMP")"

# ----------------------------------------------------------------------------
# Diff against the existing committed file (if any), then install
# ----------------------------------------------------------------------------

show_diff() {
  if command -v git >/dev/null 2>&1; then
    git --no-pager diff --no-index --color=auto -- "$1" "$2" || true
  else
    diff -u "$1" "$2" || true
  fi
}

if [[ -f "$TARGET" ]]; then
  if cmp -s "$TARGET" "$TMP"; then
    ok "$TARGET already up to date — no changes"
    exit 0
  fi
  hdr "Changes to $TARGET"
  show_diff "$TARGET" "$TMP"
  mv "$TMP" "$TARGET"
  trap - EXIT
  ok "updated $TARGET"
else
  mv "$TMP" "$TARGET"
  trap - EXIT
  ok "created $TARGET"
fi

printf '%sRemember to commit %s and %s (if changed).%s\n' \
  "$C_DIM" "$TARGET" "$DELTA" "$C_RESET"
