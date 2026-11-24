#!/usr/bin/env bash
#
# Rollback the CRM by reverting the most recent N commit(s) on main and
# pushing. The crm-azure-swa workflow redeploys automatically — the
# whole thing takes about 2 minutes end-to-end.
#
# Dry-run by default. Pass --yes to actually revert and push.
#
# Usage:
#   bin/rollback-crm.sh                revert last 1 commit (dry-run)
#   bin/rollback-crm.sh 2              revert last 2 commits (dry-run)
#   bin/rollback-crm.sh --yes          revert last 1 commit AND push
#   bin/rollback-crm.sh 2 --yes        revert last 2 commits AND push
#
# Safety checks:
#   - Must be run from the repo root
#   - Working tree must be clean
#   - Must be on main
#   - Local main must match origin/main
#   - Each revert must apply cleanly (conflicts abort the whole thing)
#
# See docs/runbook/rollback.md for the full flow + decision framework.

set -euo pipefail

count=1
confirm=false

for arg in "$@"; do
  case "$arg" in
    --yes) confirm=true ;;
    [1-9]|[1-9][0-9]) count="$arg" ;;
    -h|--help) sed -n '2,/^$/p' "$0" | sed 's/^# \?//'; exit 0 ;;
    *) echo "unknown argument: $arg" >&2; echo "usage: $0 [N] [--yes]" >&2; exit 1 ;;
  esac
done

# Safety: repo root (checked via CLAUDE.md + .github presence)
if [ ! -f CLAUDE.md ] || [ ! -d .github/workflows ]; then
  echo "ERROR: run this script from the repo root." >&2
  exit 2
fi

# Safety: no uncommitted tracked changes. Untracked files are fine —
# they can't affect a revert.
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "ERROR: working tree has uncommitted tracked changes. Commit or stash first:" >&2
  git status --short --untracked-files=no >&2
  exit 3
fi

# Safety: on main
branch="$(git rev-parse --abbrev-ref HEAD)"
if [ "$branch" != "main" ]; then
  echo "ERROR: not on main (currently on '$branch'). Checkout main first." >&2
  exit 4
fi

# Safety: local matches origin/main
echo "Fetching origin/main..."
git fetch origin main --quiet
local_sha="$(git rev-parse HEAD)"
remote_sha="$(git rev-parse origin/main)"
if [ "$local_sha" != "$remote_sha" ]; then
  echo "ERROR: local main is not in sync with origin/main." >&2
  echo "  local:  $local_sha" >&2
  echo "  remote: $remote_sha" >&2
  echo "Run 'git pull --ff-only origin main' first." >&2
  exit 5
fi

# Show what we'd revert
echo
echo "Commits that will be reverted (newest first):"
git log origin/main --oneline -n "$count"
echo
echo "This will create $count revert commit(s) on main and push to origin."
echo "The crm-azure-swa workflow will pick it up and redeploy in ~2 minutes."

if ! $confirm; then
  echo
  echo "DRY RUN — re-run with --yes to execute."
  exit 0
fi

# Execute: revert newest first
echo
echo "Reverting..."
shas=$(git log origin/main --format="%H" -n "$count")
for sha in $shas; do
  if ! git revert "$sha" --no-edit; then
    echo "ERROR: revert of $sha hit a conflict." >&2
    echo "Aborting. Resolve manually, OR run 'git revert --abort' to back out." >&2
    exit 6
  fi
  echo "  reverted $sha"
done

echo
echo "Pushing to origin/main..."
git push origin main

echo
echo "Done. Watch the redeploy:"
echo "  https://github.com/tornyglory/torny-crm-websites/actions/workflows/crm-azure-swa.yml"
echo
echo "Watch for the error rate to drop in Sentry:"
echo "  https://torny.sentry.io/issues/?project=4512483265806336"
