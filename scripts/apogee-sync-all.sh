#!/usr/bin/env bash
# apogee-sync-all.sh — re-render .claude/settings.json across every product.
#
# Runs apogee-sync-settings.sh in each opted-in product repo under
# $APOGEE_PRODUCTS_ROOT. A product opts in by committing a
# .claude/settings.delta.json (even an empty {}); repos without one — or
# without a .claude/ dir — are skipped, as is the apogee repo itself. This
# keeps bulk sync from imposing the baseline on repos that never asked for it.
# Use after changing the shared baseline so every opted-in product's committed
# composite picks up the new rules. (To render a single repo regardless of
# opt-in, run apogee-sync-settings.sh inside it directly.)
#
# Usage:
#   apogee-sync-all.sh

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

SYNC="$APOGEE_HOME/scripts/apogee-sync-settings.sh"
[[ -f "$SYNC" ]] || die "apogee-sync-settings.sh not found: $SYNC"
[[ -d "$APOGEE_PRODUCTS_ROOT" ]] || die "products root not found: $APOGEE_PRODUCTS_ROOT"

APOGEE_HOME_REAL="$(cd "$APOGEE_HOME" && pwd -P)"

hdr "Syncing settings across products in $APOGEE_PRODUCTS_ROOT"

synced=0 skipped=0 failed=0

for dir in "$APOGEE_PRODUCTS_ROOT"/*/; do
  dir="${dir%/}"
  [[ -d "$dir" ]] || continue

  name="$(basename "$dir")"

  # Skip the apogee repo itself (it ships the baseline, not a product delta)
  if [[ "$(cd "$dir" && pwd -P)" == "$APOGEE_HOME_REAL" ]]; then
    continue
  fi

  # Skip anything without a .claude/ directory
  if [[ ! -d "$dir/.claude" ]]; then
    printf '%s  skip%s %s %s(no .claude/)%s\n' "$C_DIM" "$C_RESET" "$name" "$C_DIM" "$C_RESET"
    skipped=$((skipped+1))
    continue
  fi

  # Skip repos that haven't opted in (no settings.delta.json). The delta is
  # the opt-in signal — bulk sync never imposes the baseline uninvited.
  if [[ ! -f "$dir/.claude/settings.delta.json" ]]; then
    printf '%s  skip%s %s %s(no settings.delta.json — not opted in)%s\n' "$C_DIM" "$C_RESET" "$name" "$C_DIM" "$C_RESET"
    skipped=$((skipped+1))
    continue
  fi

  hdr "$name"
  if ( cd "$dir" && bash "$SYNC" ); then
    synced=$((synced+1))
  else
    err "sync failed for $name"
    failed=$((failed+1))
  fi
done

hdr "Summary"
ok "synced: $synced"
[[ "$skipped" -gt 0 ]] && warn "skipped: $skipped (no .claude/)"
[[ "$failed"  -gt 0 ]] && err  "failed: $failed"
[[ "$failed" -eq 0 ]] || exit 1
