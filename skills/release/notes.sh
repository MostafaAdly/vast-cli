#!/usr/bin/env bash
# Gather what shipped between two refs, for QC release notes.
#
#   notes.sh <repo-dir> <base-ref> <head-ref>
#
# Prints TSV:  kind <TAB> ref <TAB> text
#   pr      <number>   <merge subject>
#   ticket  CU-<id>    <branch or commit it came from>
#   commit  <sha>      <subject>
#
# Why parse git rather than ask the GitHub search API: `gh search commits` only
# indexes a repo's DEFAULT branch, which is `production` here, so it is blind to
# staging work; and any `--limit` silently truncates. The merge commits on the
# branch already name their PR ("Merge pull request #796 from ...") and the
# bugfixer's branch convention (CU-<id>-slug) already names the ticket, so the
# local history is both complete and authoritative.
set -uo pipefail

die() { echo "notes.sh: $*" >&2; exit 2; }

[ $# -eq 3 ] || die "usage: notes.sh <repo-dir> <base-ref> <head-ref>"
dir="$1"; base="$2"; head="$3"

[ -d "$dir/.git" ] || die "not a git checkout: $dir"
git -C "$dir" rev-parse --verify --quiet "$base" >/dev/null || die "unknown ref: $base"
git -C "$dir" rev-parse --verify --quiet "$head" >/dev/null || die "unknown ref: $head"

range="$base..$head"

# --- PRs, from merge-commit subjects -----------------------------------------
# bump-stage-* / bump-prod-* are the CI's own version-bump PRs. They describe
# the pipeline, not shipped work, so QC has nothing to test in them.
git -C "$dir" log "$range" --merges --pretty='%s' 2>/dev/null \
  | grep -oE 'Merge pull request #[0-9]+ from [^ ]+' \
  | grep -vE 'from [^ ]*/bump-(stage|prod)-' \
  | sed -E 's/Merge pull request #([0-9]+) from (.*)/pr\t\1\t\2/' \
  | sort -u -t$'\t' -k2,2n

# --- ClickUp tickets, from branch names and commit text ----------------------
# The bugfixer and the team both branch as CU-<id>-slug, so the id travels with
# the merge commit even when nobody wrote it in the message.
{
  git -C "$dir" log "$range" --merges --pretty='%s' 2>/dev/null
  git -C "$dir" log "$range" --pretty='%s%n%b' 2>/dev/null
} | grep -oiE 'CU-[0-9a-z]+' \
  | tr '[:lower:]' '[:upper:]' \
  | sort -u \
  | sed -E 's/^/ticket\t/; s/$/\t/'

# --- Real commits, excluding pipeline bookkeeping ----------------------------
git -C "$dir" log "$range" --no-merges --pretty='%h%x09%s' 2>/dev/null \
  | grep -viE $'\t(chore: bump version to|chore: align package\\.json version)' \
  | sed -E 's/^/commit\t/'

# An empty range means nothing to release — a normal outcome, not a failure.
# Without this the exit status is the last grep's, which is 1 when it matches
# nothing.
exit 0
