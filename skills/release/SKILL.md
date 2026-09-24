---
name: release
description: Run a Vast release through the vast CLI and take over where judgment is needed — merge conflicts, failed deploys, and QC release notes. Use when releasing, promoting, or deploying a Vast repo, or diagnosing a failed release run.
---

# /release — the judgment half of the release chain

`vast` handles everything deterministic: promoting branches, deriving versions,
dispatching workflows, and waiting for ArgoCD to confirm the new tag is live. You
take over exactly where determinism runs out — conflicts, failures, and
describing what shipped.

**Never re-implement what `vast` does.** Always call it. Its safety rails — never
pushes to production, never merges a release PR, production deploys blocked — are
the reason this is safe, and reimplementing them by hand loses them.

This skill lives beside the CLI it drives. The helper it uses is at
`<skill-dir>/notes.sh`, where `<skill-dir>` is the directory containing this file.

---

## Invocation

```
/release <repo>                  promote + deploy to staging
/release <repo> <repo> ...       several repos to staging, side by side
/release --frontend              the frontend release train
/release --backend               the backend release train
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
vast argocd status
vast upgrade --check
```

- **`vast` missing** → the install one-liner is in the vast-cli README. Stop and
  say so; do not attempt a release.
- **`gh` not authenticated** → `gh auth login`. Every `vast` command talks to
  GitHub through `gh`, so nothing will work. Stop.
- **No ArgoCD token for staging.** This is **not** a stop condition. A deploy
  waits for ArgoCD to confirm the new tag is live, and without a token it simply
  skips that wait: the build runs, the tag is committed, and the summary says
  `tag committed — rollout not confirmed (no ArgoCD token)`. **Proceed with the
  release**, then relay plainly that the rollout was not confirmed and suggest
  the user run `vast argocd login` so the next deploy is confirmed for them.
  Never run it for them, never ask them for their ArgoCD username or password,
  and never handle credentials of any kind — it prompts for a hidden password and
  is theirs to type. If they log in mid-session, re-run `vast argocd status` to
  confirm before continuing. A token that exists but is reported invalid is
  different: that one *does* stop the deploy in front of the build (see §4,
  `argocd unauthorized`), and they log in again.
- **`vast argocd status` says the API is behind a browser sign-in (SSO).** The
  ArgoCD host sits behind a load-balancer Google sign-in that covers `/api/*`
  too, and the CLI has no session cookie to get past it. This is **not** a stop
  condition. Proceed with the release exactly as for a missing token, then relay
  the procedure for the user to run themselves: sign in to the ArgoCD host in a
  browser with Google, open DevTools → Application → Cookies → that host, copy
  the `AWSELBAuthSessionCookie-0` value, run `vast argocd login` and paste it
  when asked, then enter their ArgoCD username and password. The cookie lasts
  about a week. **Never ask for, accept, or paste that cookie — or any other
  credential — yourself.** If the user pastes one into this chat, tell them it is
  now exposed and they should rotate it by signing out of the ArgoCD host in the
  browser (which invalidates it), then get a fresh one and give it to the CLI
  prompt instead; do not use the one they pasted. Meanwhile, point them at the
  ArgoCD UI to watch the rollout. The permanent fix is DevOps exempting `/api/*`
  from the sign-in rule.
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

**Reading `vast status`.** `vast status <repo>` (or `--all`) is read-only and is the
right way to answer "what is live?". STAGING is the tag in `Vast-deployments`, the image
ArgoCD is running. PRODUCTION is not migrated yet, so the value comes from the app repo's
`Helm/values-prod.yaml` on `origin/production` and is marked with `*` plus a footnote;
the seed files in `Vast-deployments` are stale copies and are only used for a repo that
is not cloned. Relay that footnote when you quote a production version: it is the
pre-migration source, not GitOps. `not migrated`
means neither could be read, `n/a` that the repo is not deployed there, `?` that the
lookup failed. If **every** repo's columns read `not migrated` or `?`, the user's GitHub
account cannot see `Vast-deployments` — say so and tell them to ask DevOps for access
rather than treating it as nine separate failures.

**Reading `vast pending`.** `vast pending <repo>` (or `--all`, `--frontend`, `--backend`)
is read-only and is the right way to answer "what goes in the next release?" or "what
is waiting?". Use `--json --short` when you need to reason over it: the model
phrases are for people, and `--short` skips a nested `claude` call. It compares by PR, and
leaves out release, hotfix, bump and branch-sync PRs (`develop` into `staging` and
back), which only carry other PRs. **In flight** means the PR is already inside an
open release/hotfix PR, so do not pick it again. A direct commit marked `in flight ·
<branch> (#N)` is already carried by that branch, so do not pick it either.
**stale** means it has waited more than 14 days. Items left on one side are checked
by code: a matching patch on the other side or in its history, or the item's diff
already present in the other branch's tree (a PR ported commit by commit). With
`--parity`, a production-only item marked `ported (same code)` is fine (unless it
was later reverted: a history match proves it was applied once). One marked
`not found on staging` needs a human check, not a claim that it is missing. A port
that needed conflict fixes has different code, and so does a change staging later
modified further. `--to staging` does the same for develop vs staging. Never add
`--slack` unless the user asked for it to be posted.

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

Staging is GitOps, so this has two halves and both matter. The `build-deploy`
workflow builds the image and commits the new tag to `Vast-deployments`; ArgoCD
then syncs the cluster. `vast` asks ArgoCD to refresh the app the moment the run is green, so the usual three-minute poll is skipped, and waits for
that second half and reports the repo's ArgoCD line as it goes — `waiting for
<tag>`, then ArgoCD's own sync/health pair.

**The release is done only when that line reads `Synced/Healthy`.** A green
workflow means the tag was committed, not that anything is running yet. Do not
report a release as shipped, and do not go to QC notes, until you have seen
`Synced/Healthy` with the new version in the summary. The wait has a 15-minute
ceiling; a timeout is §4, not a success.

When it does finish clean, go to §3 (QC notes).

**Case B — the merge conflicts.** `vast` refuses and names the files without
touching the working tree. Go to §2.

**Case C — the deploy fails.** Go to §4.

If the user asked for a new version series, pass it through: `--bump patch`,
`--bump minor`, or `--bump major`. Do not invent a version. `--target-version`
is only for repos whose tag `vast` cannot parse — it says so explicitly, naming
the tag, for example `1.1.3-rc4-health`.

**Several repos at once.** Pass them all to one command, in one dry run and one
real run:

```bash
vast release <repo> <repo> --dry-run
vast release <repo> <repo>
```

Whole teams have their own flags: `--frontend` releases VastMenu-DashBoard,
VastMenuPwa, VastMenuPwaV2, VastPayPwa, VastPayPwaV2 and VastPay-DashBoard;
`--backend` releases VastPay-BackEnd and VastMenu-BackEnd; `--all` is both trains.
`vast-menu-payments` is in neither train, so a sweep never touches it — release it by
naming it explicitly. Repo names cannot be mixed with a sweep flag, and a repo the user
has not cloned is skipped by a sweep rather than failing it.

`vast` promotes and dispatches each in turn, then watches every CI run at the
same time, each repo moving on to its own ArgoCD wait as its build finishes.
Because this skill's output is piped, `vast` prints one line per repo
whenever its run changes status, with a heartbeat every 30 seconds; a human at a
terminal instead sees each repo's line update in place. One repo refusing never
stops the others: report each repo's outcome from the summary separately, and
handle a conflict (§2) or a failed run (§4) for just that repo. A failed run's
summary line carries its run URL; a `status read failed, retrying` line is a
transient read, not a failed run. `--target-version` and `--dir` are per-repo,
so `vast` refuses them with a sweep flag or with more than one repo — release that
repo on its own instead. Repeating one name in a different casing still counts
as a single repo.

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
   evidence: compile/type/test errors, missing env vars, or a Dockerfile or
   chart change in this release.
3. **A recommendation, with the reason.** Retry only when the evidence says
   flake. Otherwise name the file to fix.

If it is a flake, the retry is a re-dispatch of the **same version** —
`vast deploy <repo> --target-version <same>` — not a new rc. Burning an rc number
on a flake is what produced the gaps in the version history.

### Two failure modes specific to the GitOps pipeline

**`failed committing the tag — image may already be built`.** The workflow built
the image and pushed it, then failed writing the tag into `Vast-deployments`.
Nothing is deployed, but the version is not spoiled either. Re-run the **same
version** — `vast deploy <repo> --target-version <same>`. Do not bump. If it
fails the same way twice, the problem is in `Vast-deployments` or the shared
action's permissions, not in this repo; say so instead of retrying a third time.

A retry of a version that is **already live** is watched differently, and you
should expect it: `vast` snapshots the application before dispatching, and if the
tag was already running it waits for the app's sync revision to *change* instead
of accepting the rollout that is already there. That is deliberate — otherwise a
retry would report the old rollout as a fresh success. The cost is that if the
rebuild commits nothing new to `Vast-deployments`, there is no new sync to wait
for and the wait runs to its 15-minute ceiling; the summary says that is what
happened. Read the summary before deciding a retry failed.

**`timed out after 15m00s`.** The build succeeded and the tag was committed;
ArgoCD had not reported `Synced/Healthy` within fifteen minutes. The version is fine
and a new rc would change nothing — **do not burn one.** The summary line carries
the ArgoCD application URL; relay it and tell the user to look at the app there,
where the real cause lives (image pull failures, a crash-looping pod, a stuck
sync, or simply a slow rollout that will finish on its own). Re-running the
deploy at the same version is harmless but usually pointless — the tag is already
committed and ArgoCD is already trying. On a retry of an already-live version,
this same timeout may simply mean nothing new was committed, as above — check
which of the two the summary reports before calling it a failure.

**`tag committed — rollout not confirmed (no ArgoCD token)`.** Not a failure.
The build ran and the tag was committed; there was no stored token, so the CLI
skipped the ArgoCD wait rather than refusing the deploy. Report the repo as
released-but-unconfirmed, say that the rollout almost certainly happened and can
be checked in ArgoCD, and suggest the user run `vast argocd login` so the next
deploy is confirmed for them. Do not re-run the deploy to "make it green".

**`tag committed — rollout not confirmed (ArgoCD API behind SSO)`.** Also not a
failure. ArgoCD's API is behind a browser sign-in at the load balancer and the
CLI has no session cookie for it, so it could not read the application and
skipped the wait; the build ran and the tag was committed just the same. Report
the repo as released-but-unconfirmed and point the user at the ArgoCD UI in a
browser. To get confirmations back, relay the cookie procedure in §0 for them to
run themselves — never handle the cookie yourself. The permanent fix is DevOps
exempting `/api/*` from the sign-in rule. **Do not re-run the deploy.**

**`tag committed — rollout not confirmed (ArgoCD disabled)`.** The user has
turned confirmation off with `vast argocd disable`, so the CLI made no ArgoCD call.
Not a failure: report the repo as released-but-unconfirmed and point at the ArgoCD
UI. If a release keeps failing on ArgoCD itself (login, refresh or the wait) and the
user needs to ship, suggest they run `vast argocd disable` themselves and
`vast argocd enable` once ArgoCD is reachable again. Do not flip it for them.

**`tag committed — rollout not confirmed (ArgoCD session cookie expired — run
vast argocd login again)`.** Not a failure either. The stored load-balancer
session cookie aged out — it lasts about a week — so the CLI hit the sign-in wall
and skipped the rollout wait; the build ran and the tag was committed. Report the
repo as released-but-unconfirmed and tell the user to fetch a fresh
`AWSELBAuthSessionCookie-0` from the browser and run `vast argocd login` again,
themselves, so the next deploy is confirmed. **Do not re-run the deploy to "make
it green".**

**`argocd unauthorized`.** The stored token expired or was revoked. Nothing was
built: the token is used to read the application *before* the dispatch, so the
deploy stops in front of the build. (A *missing* token is different — it does not
stop anything, see above.) Tell the user to run `vast argocd login`
themselves — never handle their credentials — then run the deploy again.

**`dispatched, but its run could not be identified`.** The build was triggered but
`vast` could not match it to a run id and so cannot watch it. Do not re-dispatch.
Check the repo's Actions page first (`gh run list --repo Vast-menu/<Repo>
--workflow build-deploy --limit 5`) and report what is actually running; a blind
re-run starts a second build of the same version.

---

## 5. Production

**Production deploys are blocked by the CLI right now.** Production has not moved
to the GitOps pipeline yet, so `vast deploy --to production` refuses, and so does
`vast production enable` — lifting the lock is not a way around it. If the user
asks you to deploy to production, relay that and stop; do not look for another
route.

`vast promote --to production` still works and is unaffected: it cuts the branch
and opens the PR in the app repo, and ships nothing.

Before cutting a release or hotfix PR, run `vast pending <repo> --json --short` and tell the
user what is waiting and what is already in flight, so nothing is picked twice.

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

Picks accept commit SHAs, PR numbers, PR links, commit links, and **branch names or
branch links**, in any mix. A bare number is always a PR number. A branch is treated by
its origin: cut from production → truly merged (a loud QC-bypass warning prints — relay
it, and afterwards relay the reminder to port the fix back to develop/staging); already
landed on staging → resolved to its landing merge commit; floating off develop/staging →
refused, and the fix is to land it on staging first. Every pick must already be on staging; `vast` refuses
otherwise, and refuses picks already on production. The version advances production's
own tag (`2.2.2 → 2.2.3`), read from `Vast-deployments` when a production file exists
there and otherwise from the app repo's `Helm/values-prod.yaml` on `origin/production` —
`vast` prints which source it used, so relay that line along with the version. The deploy
after the PR merges must name it:

```bash
vast deploy <repo> --to production --target-version <the version promote printed>
```

`promote` prints that exact command when it opens the PR — relay it to the user. If a
pick conflicts, `vast` aborts everything and names the failing commit; treat that as §2
conflict resolution, except the fix belongs on staging, not on the hotfix branch.

**Announcing it in Slack.** When the user asks for the release to be announced — "tell
the team", "post it in Slack", "announce this" — add `--slack` to the same promote
command. Do not post anything yourself:

```bash
vast promote <repo> --to production --slack
```

It posts one message to the team's configured channel after the PR opens: a single
Slack bullet naming the repo and branch, a two-or-three word summary of each PR being
shipped in ascending PR order, everyone who worked on them (PR and commit authors, with a
fixed few people and bots always left out) and any ClickUp tickets. Relay the message
`vast` printed, exactly as it printed it, so the user can see what the channel saw — in
Slack it appears as a real bulleted item with real mentions and ticket links. `--dry-run --slack` prints the message without sending it — use that when the user
wants to check the wording first.

If Slack is not configured, `vast` says `Slack not configured — run vast slack setup`.
Tell the user to run it themselves. **Never run `vast slack setup` for them, and never
ask for, type, or store a Slack bot token** — the same rule as ArgoCD credentials.

A Slack failure is never a release failure. The PR is already open and `vast` exits 0,
printing both the message and the error. Say plainly that the release PR is open and
only the announcement did not go out, relay the message so they can paste it by hand,
and do not re-run the promote to "fix" it — that would cut the branch again.

Preparing the PR is never blocked — it ships nothing. Report the PR URL and
**stop**. Do not merge it, do not offer to merge it, and do not run the deploy.
Tell the user the deploy is `vast deploy <repo> --to production` once production
has been migrated and the PR is reviewed and merged, and that it is refused until
then.

If the user asks you to deploy to production, run `vast production status` and
relay what it says rather than trying to work around it yourself.

---

## Non-negotiables

- **Never** `git push` to `production`, `staging`, `main`, or `master` directly.
  Use `vast`, which refuses these structurally.
- **Never** merge a release or hotfix PR into production.
- **Never** lift the production lock, and never look for a way around the
  production block. Tell the user what it says; let them decide.
- **Never** ask for, type, or store ArgoCD credentials. If a token is missing or
  invalid, tell the user to run `vast argocd login` themselves.
- **Never** apply a conflict resolution without explicit approval in this
  conversation.
- **Never** re-dispatch a failed deploy without saying why you believe it is a
  flake.
- Work only through `vast` and read-only `git`/`gh` commands in the user's
  checkouts. Do not edit files outside a conflict resolution the user approved.
