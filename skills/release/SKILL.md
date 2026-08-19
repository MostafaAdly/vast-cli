---
name: release
description: Run a Vast release through the vast CLI and take over where judgment is needed — merge conflicts, failed deploys, and QC release notes. Use when releasing, promoting, or deploying a Vast repo, or diagnosing a failed release run.
---

# /release — the judgment half of the release chain

`vast` handles everything deterministic: promoting branches, deriving versions,
dispatching workflows, merging bump PRs. You take over exactly where determinism
runs out — conflicts, failures, and describing what shipped.

**Never re-implement what `vast` does.** Always call it. Its safety rails — never
pushes to production, never merges a release PR, production deploys locked by
default — are the reason this is safe, and reimplementing them by hand loses them.

This skill lives beside the CLI it drives. The helper it uses is at
`<skill-dir>/notes.sh`, where `<skill-dir>` is the directory containing this file.

---

## Invocation

```
/release <repo>                  promote + deploy to staging
/release <repo> --to production  cut the release PR (never deploys)
/release triage <repo>           diagnose the last failed run only
/release notes <repo>            draft QC notes only
```

`<repo>` accepts any casing — `vast` resolves it to the canonical name.

---

## 0. Before anything: is the tool usable?

Run this first on an unfamiliar machine. It is cheap and it turns four
confusing failure modes into one clear sentence.

```bash
vast --version    || echo "vast is not installed"
gh auth status    || echo "gh is not authenticated"
vast upgrade --check
```

- **`vast` missing** → the install one-liner is in the vast-cli README. Stop and
  say so; do not attempt a release.
- **`gh` not authenticated** → `gh auth login`. Every `vast` command talks to
  GitHub through `gh`, so nothing will work. Stop.
- **A newer release exists.** `vast upgrade --check` says
  `Latest is X; you have Y`. Run `vast upgrade` now, before starting, and say
  that you did. The instructions in this skill describe the current CLI, so
  working against an old one is how you end up reporting behaviour that no
  longer exists.

  **Never upgrade in the middle of a release.** If work has already started —
  a promote landed, a deploy is running, a PR is open — finish it on the version
  you began with and upgrade afterwards. Swapping the binary mid-flow changes the
  tool under your own feet.

- **The repo is not on this machine.** `vast` reports `not cloned` rather than
  failing obscurely. Tell the user to run `vast clone --team <their team>`, or
  `vast init` if they have it checked out somewhere `vast` has not been shown
  yet. Do not clone it for them without asking — you do not know where they want it.

---

## 1. Staging release — the default path

The two `*-BackEnd` repos have no develop branch; `vast release` skips their
promotion step automatically and deploys what is on staging. That is normal —
do not report it as a problem.

**Step 1. Read the state first.** Always dry-run before doing anything:

```bash
vast release <repo> --dry-run
```

Report what it says: how many commits are moving, whether the merge is clean,
and the version it derived. Then act on which case you are in.

Note that even a dry run fast-forwards the local `develop` and `staging` to match
origin, and prints what it pulled. That is expected. A branch carrying local
commits is reported and left alone.

**Case A — clean.** Run it for real:

```bash
vast release <repo>
```

This watches CI and merges the bump PR, so it can take several minutes. When it
finishes, go to §3 (QC notes).

**Case B — the merge conflicts.** `vast` refuses and names the files without
touching the working tree. Go to §2.

**Case C — the deploy fails.** Go to §4.

If the user asked for a new version series, pass it through: `--bump patch`,
`--bump minor`, or `--bump major`. Do not invent a version. `--target-version`
is only for repos whose tag `vast` cannot parse — it says so explicitly, naming
the tag, for example `1.1.3-rc4-health`.

---

## 2. Conflict resolution

`vast` has already established the merge is dirty and has changed nothing. The
checkout is clean and must stay that way until the user approves.

1. For each conflicting file, read both sides:
   ```bash
   git -C <dir> diff origin/staging...origin/develop -- <file>
   git -C <dir> log --oneline -5 origin/develop -- <file>
   git -C <dir> log --oneline -5 origin/staging -- <file>
   ```
   Get `<dir>` from `vast status <repo>`, or from `~/.vast-cli/config.json`.
2. Explain, per file, **what each side is trying to do** — not just that they
   differ. Name the commits and who wrote them.
3. Propose a resolution as a concrete diff.
4. **Stop and ask for approval. Write nothing until the user says go.**

**Payment paths are never resolved quietly.** If a conflicting file sits under a
payments/checkout/gateway path, or the repo is `vast-menu-payments`, say so
prominently and treat approval as required even if the resolution looks obvious.
Getting a payment path wrong costs real money.

If the user approves, apply the resolution on the target branch, commit it with a
message naming both sides, then re-run the `vast` command that was blocked. If
the user declines, stop — do not offer to "just try again".

---

## 3. QC release notes

After a successful staging deploy, draft notes automatically and print them.
**Never post them anywhere** — posting to a team channel is the user's call.

Gather with the helper next to this file, which knows the GitHub API traps:

```bash
bash <skill-dir>/notes.sh <repo-dir> origin/production origin/staging
```

It prints TSV rows of `pr`, `ticket`, and `commit`. Version-bump PRs and commits
are already filtered out.

Turn that into notes aimed at **QC, who are not developers** — describe what to
test and where, not what changed in the code:

```
*<Repo> <version> is on staging*

*What to test*
• <feature or fix, in plain language — where in the app, what should happen>
• …

*Tickets*
• CU-<id> — <title>
```

Resolve ticket titles with the ClickUp connector when it is available; if it is
not, list the bare ids rather than guessing titles.

Keep it short. If nothing user-facing shipped — a release of only chores or
dependency bumps — say exactly that in one line instead of padding the list.

Slack formatting: send `**bold**` (Slack converts it), and use twelve `─` for a
section rule. Blank lines between sections get stripped.

**Do not confuse these with a production PR description.** `vast promote --to
production` writes its own PR body from the commit subjects, and `--summarize`
makes a small local model read the diff instead. Both are for reviewers of that
PR. The notes here are for QC testing staging, in plain language, and are a
different artefact. Never paste one into the other.

---

## 4. Failure triage

A failed deploy is where the old habit was to re-fire blind at a new rc number.
Do not do that. Diagnose first.

```bash
gh run list --repo Vast-menu/<Repo> --workflow <workflow> --limit 5 \
  --json databaseId,status,conclusion,createdAt,displayTitle
gh run view <id> --repo Vast-menu/<Repo> --log-failed
```

Report:

1. **Which step failed**, quoting the real error line — not a paraphrase.
2. **Flake or real.** Flake evidence: timeouts, ECR/network/registry errors,
   runner allocation failures, or the same commit having succeeded before. Real
   evidence: compile/type/test errors, missing env vars, a Dockerfile or Helm
   change in this release.
3. **A recommendation, with the reason.** Retry only when the evidence says
   flake. Otherwise name the file to fix.

If it is a flake, the retry is a re-dispatch of the **same version** —
`vast deploy <repo> --target-version <same>` — not a new rc. Burning an rc number
on a flake is what produced the gaps in the version history.

---

## 5. Production

Production is two commands with a human review gate between them, and
`/release <repo> --to production` covers only the first:

```bash
vast promote <repo> --to production                 # cuts release/X.Y.Z + PR
vast promote <repo> --to production --as hotfix     # cuts hotfix/X.Y.Z + PR
```

**Selective promotion.** When the user wants only some of staging shipped — "just this
PR", "only these two commits" — use `--pick`:

```bash
vast promote <repo> --to production --pick 812 <sha> <pr-link>
```

Picks accept commit SHAs, PR numbers, PR links, and commit links, in any mix. A bare
number is always a PR number. Every pick must already be on staging; `vast` refuses
otherwise, and refuses picks already on production. The version advances production's
own tag (`2.2.2 → 2.2.3`), and the deploy after the PR merges must name it:

```bash
vast deploy <repo> --to production --target-version <the version promote printed>
```

`promote` prints that exact command when it opens the PR — relay it to the user. If a
pick conflicts, `vast` aborts everything and names the failing commit; treat that as §2
conflict resolution, except the fix belongs on staging, not on the hotfix branch.

Preparing the PR is never blocked by the production lock — it ships nothing.
Report the PR URL and **stop**. Do not merge it, do not offer to merge it, and do
not run the deploy. Tell the user the deploy is
`vast deploy <repo> --to production` after the PR is reviewed and merged, and that
it needs `vast production enable` first.

If the user asks you to deploy to production, run `vast production status` and
relay what it says rather than lifting the lock yourself.

---

## Non-negotiables

- **Never** `git push` to `production`, `staging`, `main`, or `master` directly.
  Use `vast`, which refuses these structurally.
- **Never** merge a release or hotfix PR into production.
- **Never** lift the production lock. Tell the user the command; let them run it.
- **Never** apply a conflict resolution without explicit approval in this
  conversation.
- **Never** re-dispatch a failed deploy without saying why you believe it is a
  flake.
- Work only through `vast` and read-only `git`/`gh` commands in the user's
  checkouts. Do not edit files outside a conflict resolution the user approved.
