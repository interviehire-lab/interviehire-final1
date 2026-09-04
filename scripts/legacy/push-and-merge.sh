#!/usr/bin/env bash
#
# legacy/push-and-merge.sh — safely commit the "Apply" feature (LF-normalized),
# push feat/data-rights, then merge origin/main and stop cleanly at conflicts.
#
# HOW TO RUN (Windows):
#   1. Right-click the IntervieHire repo folder -> "Git Bash Here"
#      (or: cd into the repo in Git Bash). You MUST be at the repo root.
#   2. Copy this file into that folder (or run it with its full path).
#   3. bash push-and-merge.sh          # Phase A: commit + push feature
#      bash push-and-merge.sh merge    # Phase B: merge origin/main
#
# Nothing here force-deletes history. A backup tag is created first, so any
# step is recoverable. Read the echoes as it runs.

set -uo pipefail

# ---- sanity: are we at the repo root? -------------------------------------
if [ ! -d .git ]; then
  echo "ERROR: no .git here. cd into the IntervieHire repo root first." >&2
  exit 1
fi
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
STAMP="$(date +%Y%m%d-%H%M%S)"

phase_a() {
  echo "=================================================================="
  echo " PHASE A — normalize line endings, commit Apply feature, push"
  echo " current branch: $BRANCH"
  echo "=================================================================="

  # 0. Clear any stale lock left by another tool (native Windows rm works).
  rm -f .git/index.lock .git/objects/maintenance.lock 2>/dev/null || true

  # 1. Safety backup tag of the CURRENT committed state (before we touch it).
  git tag "backup/pre-apply-$STAMP" && echo ">> backup tag: backup/pre-apply-$STAMP"

  # 2. Write a .gitattributes so the repo stores LF and future CRLF churn dies.
  cat > .gitattributes <<'ATTR'
# Normalize all text to LF in the repo; auto-detect binaries.
* text=auto eol=lf

# Explicit binary guards (never touch these).
*.png  binary
*.jpg  binary
*.jpeg binary
*.gif  binary
*.ico  binary
*.webp binary
*.mp4  binary
*.pdf  binary
*.woff binary
*.woff2 binary
*.ttf  binary
*.eot  binary
*.otf  binary
*.zip  binary
*.wasm binary
ATTR
  git config core.autocrlf false

  # 3. Re-stage every tracked file THROUGH the normalization filter.
  #    Pure-CRLF files become identical to HEAD (LF) and DROP OUT of the diff,
  #    so the commit contains only your real changes.
  git add --renormalize .
  # 4. Add the new (untracked) feature files + .gitattributes, also normalized.
  git add -A

  echo ""
  echo ">> Files that will be committed (should be ONLY real changes + new files):"
  git diff --cached --stat
  echo ""
  echo ">> Sanity: number of staged files ($(git diff --cached --name-only | wc -l))."
  echo ">> If you see ~30 files (not 300), normalization worked. Review above."
  echo ""
  read -r -p "Proceed to commit these? [y/N] " ok
  [ "$ok" = "y" ] || { echo "Stopped. Nothing committed. (Backup tag kept.)"; exit 0; }

  git commit -m "feat(apply): candidate self-serve public Apply flow

- backend: public apply endpoint + application-questions & uploads utils;
  applicant/job/organisation model + schema columns with init_db migrations
- dashboard: application-questions editor, apply-share panel, help pages,
  deep-analysis / job-detail wiring, landing Navbar apply CTA
- legal/content: privacy, terms, DPA updates
- api.md updated for the apply endpoints"

  echo ""
  echo ">> Pushing $BRANCH (fast-forward, no conflicts expected)..."
  git push origin "$BRANCH"
  echo ""
  echo "PHASE A DONE. Your Apply feature is committed and pushed to $BRANCH."
  echo "Next: run  bash push-and-merge.sh merge   to integrate origin/main."
}

phase_b() {
  echo "=================================================================="
  echo " PHASE B — merge origin/main into $BRANCH, resolve conflicts"
  echo "=================================================================="
  rm -f .git/index.lock 2>/dev/null || true

  # Refuse to merge with a dirty tree (protects uncommitted work).
  if [ -n "$(git status --porcelain)" ]; then
    echo "ERROR: working tree not clean. Commit or stash first (run Phase A)." >&2
    git status --short
    exit 1
  fi

  git fetch origin
  git tag "backup/pre-merge-$STAMP" && echo ">> backup tag: backup/pre-merge-$STAMP"

  echo ">> Merging origin/main (behind by:$(git rev-list --count HEAD..origin/main) commits)..."
  if git merge --no-edit origin/main; then
    echo ""
    echo "MERGE CLEAN — no conflicts. Pushing $BRANCH..."
    git push origin "$BRANCH"
    echo ""
    echo "PHASE B DONE. $BRANCH now contains origin/main + your feature."
    land_on_main_hint
  else
    echo ""
    echo "=================================================================="
    echo " CONFLICTS TO RESOLVE (this is expected)."
    echo "=================================================================="
    echo "Conflicted files:"
    git diff --name-only --diff-filter=U | sed 's/^/   /'
    echo ""
    echo "Because line endings are normalized, these are REAL content conflicts,"
    echo "not line-ending noise. For each file:"
    echo "   1. Open it, find <<<<<<< / ======= / >>>>>>> markers."
    echo "   2. Keep the correct combination of BOTH sides."
    echo "   3. git add <file>"
    echo "When ALL are resolved:"
    echo "   git commit --no-edit        # completes the merge"
    echo "   git push origin $BRANCH"
    echo ""
    echo "To abort and return exactly to pre-merge state:"
    echo "   git merge --abort"
    echo ""
    land_on_main_hint
  fi
}

land_on_main_hint() {
  cat <<'HINT'

------------------------------------------------------------------
TO LAND ON main (after this branch is merged & pushed):

  RECOMMENDED — open a Pull Request (reviewable, reversible):
     Go to GitHub -> "Compare & pull request": feat/data-rights -> main.

  OR merge locally and push main directly (if you have permission):
     git checkout main
     git merge --ff-only origin/main      # bring local main current
     git merge feat/data-rights           # fast-forwards (feature has main)
     git push origin main
------------------------------------------------------------------
HINT
}

case "${1:-commit}" in
  commit|"") phase_a ;;
  merge)     phase_b ;;
  *) echo "usage: bash push-and-merge.sh [commit|merge]"; exit 1 ;;
esac
