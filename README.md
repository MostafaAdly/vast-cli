# Vast CLI

[![release](https://img.shields.io/github/v/release/MostafaAdly/vast-cli?label=release)](https://github.com/MostafaAdly/vast-cli/releases/latest)
[![node](https://img.shields.io/badge/node-%E2%89%A518-brightgreen)](https://nodejs.org)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

Release tooling for Vast Group. Replaces the hand-run `develop → staging → production`
ritual with a few commands, and derives version numbers from what is actually deployed
rather than from memory.

```bash
vast status --all                     # what is live everywhere
vast release VastPayPwa               # develop → staging, versioned, deployed, confirmed live
vast release VastPayPwa VastMenuPwa   # both at once, side by side
```

---

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/MostafaAdly/vast-cli/main/install.sh | bash
```

Then point it at your repos:

```bash
vast init
```

That scans your disk for Vast checkouts and remembers where each one lives. It matches
repos by their `origin` remote, not by folder name, so it does not matter what you called
them or where you put them — including several different places.

It searches the usual spots (`~/Workshop`, `~/work`, `~/projects`, `~/Developer`, `~/src`,
`~/Desktop` and similar) **plus whatever directory you are standing in**. Keep them
somewhere else?

```bash
vast init --root /opt/work    # searched now, and remembered for next time
```

Missing some?

```bash
vast clone --team frontend    # or backend, infra, all
```

<details>
<summary>Install options and what it touches</summary>

| Variable | Default | Purpose |
|---|---|---|
| `VAST_VERSION` | latest release | Install a specific tag |
| `VAST_BIN_DIR` | `~/.local/bin` | Where the `vast` shim goes |
| `VAST_CLI_HOME` | `~/.vast-cli` | Where the bundle and config live |

The installer checks `node`, `git`, `gh` and `gh auth status` before doing anything,
verifies the download parses before replacing a working install, and never uses `sudo`.
It writes exactly two paths: `~/.vast-cli/` and one shim in `~/.local/bin/`.

</details>

### Or let Claude do all of it

Paste this into Claude Code and it will install the CLI, the skill, and wire up your repos:

```
Set up the Vast CLI and its release skill on my machine.

1. Install the CLI:
   curl -fsSL https://raw.githubusercontent.com/MostafaAdly/vast-cli/main/install.sh | bash

2. Check it worked: run `vast --version` and `gh auth status`.
   If gh is not authenticated, stop and tell me — nothing works without it.

3. Install the Claude Code skill:
   mkdir -p ~/.claude/skills/release
   curl -fsSL https://raw.githubusercontent.com/MostafaAdly/vast-cli/main/skills/release/SKILL.md -o ~/.claude/skills/release/SKILL.md
   curl -fsSL https://raw.githubusercontent.com/MostafaAdly/vast-cli/main/skills/release/notes.sh -o ~/.claude/skills/release/notes.sh
   chmod +x ~/.claude/skills/release/notes.sh

4. Find my repos: run `vast init` and tell me what it found.
   If it finds nothing, ask me where I keep them and re-run with
   `vast init --root <path>`.

5. Run `vast argocd status`. If there is no staging token, tell me to run
   `vast argocd login` myself — do not run it and do not ask me for my password.

6. Show me `vast status --all`.

Do not deploy, promote, or release anything. If a step fails, stop and tell me
which one and the exact error.
```

### From source

For working on the CLI itself:

```bash
gh repo clone MostafaAdly/vast-cli ~/tools/vast-cli
cd ~/tools/vast-cli && npm install && npm run build && npm link
```

Update with `git pull && npm run build`. `vast upgrade` refuses on a source checkout and
tells you this instead.

## Update

```bash
vast upgrade           # install the latest release
vast upgrade --check   # say what is available, change nothing
```

The CLI checks for new releases once a day, in a detached background process, and shows
a one-line hint on your next command. It never delays anything.

## Uninstall

```bash
rm -rf ~/.vast-cli ~/.local/bin/vast
```

Two paths, nothing else left behind. If you installed from source, `npm rm -g vast-cli`
and delete the checkout.

---

## Prerequisites

- **Node.js ≥ 18**
- **git ≥ 2.38** — conflict detection uses `git merge-tree --write-tree`
- **[GitHub CLI](https://cli.github.com/) (`gh`), authenticated.** Check with
  `gh auth status`. Every command talks to GitHub through `gh`; nothing works without it.
- Access to the Vast-menu organisation
- **An ArgoCD staging account** and one `vast argocd login` on this machine. Deploys wait
  for ArgoCD to confirm the new tag is live. The staging ArgoCD host sits behind a
  load-balancer Google sign-in, so `vast argocd login` also asks you to paste the
  `AWSELBAuthSessionCookie-0` cookie from a browser that has already signed in — see
  [When ArgoCD sits behind a browser sign-in](#when-argocd-sits-behind-a-browser-sign-in).
  Without a token or without that cookie, `vast release` and `vast deploy` still run, but
  they cannot confirm the rollout and say so in the summary. Check with
  `vast argocd status`.

## Commands

Run `vast` with no arguments for an overview, and `vast <command> --help` for options and
worked examples.

| Command | What it does |
|---|---|
| `vast init` | Find your checkouts and remember where they are |
| `vast clone` | Clone the repos your team needs |
| `vast upgrade` | Update to the latest release |
| `vast status` | Deployed versions and branch drift |
| `vast release` | Promote develop→staging, derive the version, deploy, wait until it is live |
| `vast promote` | Merge branches, or open a release/hotfix PR into production |
| `vast deploy` | Ship a version already on the branch — one repo, or `--frontend`/`--backend`/`--all` |
| `vast argocd` | Log in to ArgoCD, check the stored token, log out |
| `vast workflow` | Trigger a raw GitHub Actions workflow — never on a protected branch |
| `vast production` | Show or change the production deploy lock |

### The everyday flow

```
develop  ──▶  staging  ──▶  production
           vast release    vast promote --to production
                           (production deploy blocked until migrated)
```

Staging is GitOps. There are no bump PRs any more. `vast release` promotes the branch,
derives the version, and dispatches the repo's `build-deploy` workflow. That workflow
builds the image and commits the new tag to `Vast-deployments`; ArgoCD notices the commit
and syncs the cluster. The CLI asks ArgoCD to refresh the app the moment the run is green, so ArgoCD's usual three-minute git poll is skipped and the wait is the rollout itself, typically under a minute.

Because the workflow going green only means the tag was *committed*, the CLI does not stop
there. It then watches the repo's ArgoCD application until it reports **Synced/Healthy**
running an image carrying the new tag, and only then calls the release done:

```
  VastPayPwa  argocd vastpay-pwa  Synced/Healthy  3m12s  https://argocd-stg.vastmenu.com/applications/vastpay-pwa
```

Until the tag shows up the line reads `waiting for <tag>`, then tracks ArgoCD's own
sync/health pair (`OutOfSync/Progressing` and so on). The ceiling is **15 minutes**; past
that the repo is reported as timed out, with the ArgoCD URL to look at. A timeout means
the rollout is still in ArgoCD's hands — it does not mean the build failed.

Confirmation needs the ArgoCD API to be reachable by the CLI — a stored token on its own
is not enough. When it is not, the deploy still runs: the image is built and the tag is
committed, the ArgoCD wait is skipped, and the summary says so instead of claiming the
version is live. Without a token that reads `tag committed — rollout not confirmed (no
ArgoCD token)`, and `vast argocd login` fixes it. The staging ArgoCD host also sits behind
a load-balancer Google sign-in, so `vast argocd login` asks for the browser session cookie
alongside your ArgoCD password; when that cookie expires the summary reads `tag committed
— rollout not confirmed (ArgoCD session cookie expired — run vast argocd login again)` and
you log in once more — see
[When ArgoCD sits behind a browser sign-in](#when-argocd-sits-behind-a-browser-sign-in).

Every promotion fetches first, then fast-forwards your local branches to match, reporting
what it pulled:

```
pulled 24 new commit(s) into develop
```

A branch carrying local commits is reported and left alone rather than rewritten — the
promotion merges `origin/*` regardless, so your work is never at risk.

### Reading `vast status`

```bash
vast status --all         # every repo, one screen
vast status VastPayPwa    # one repo
```

**STAGING** is the tag in that repo's `Vast-deployments` values file — the image
ArgoCD is actually running. **PRODUCTION** is not migrated yet, so what is running
there is still recorded in the app repo's own `Helm/values-prod.yaml` on
`origin/production`. That is what the column shows, marked with `*` and a footnote
under the table. The seed files that already exist in `Vast-deployments` for
production are copies taken at cutover and drift as soon as someone deploys by hand
(one already had), so they are only used for a repo you have not cloned. When
neither is readable the cell reads `not migrated`. `n/a` means the repo is not
deployed to that environment at all, and `?` means the lookup itself failed. Once
production migrates, the column reads `Vast-deployments` like staging does.

**DRIFT** is how many commits are waiting on `develop` that `staging` does not
have. Only DRIFT needs a local checkout — the tags are read over the API, so they
are reported even for a repo you have never cloned.

### Versions are derived, not typed

The next version comes from the tag currently deployed, read out of the repo's values file
in `Vast-deployments` (`deployments/helm/staging/<app>/stage.yaml`) — the same file ArgoCD
deploys from. So it reflects what is actually running, not what you remember deploying.
Nothing is read from the app repo's own Helm values any more.

```bash
vast release VastPayPwa                 # 1.5.5-rc15 → 1.5.5-rc16   continue the series
vast release VastPayPwa --bump patch    # 1.5.5-rc15 → 1.5.6-rc1
vast release VastPayPwa --bump minor    # 1.5.5-rc15 → 1.6.0-rc1
vast release VastPayPwa --bump major    # 1.5.5-rc15 → 2.0.0-rc1
vast release VastPayPwa --dry-run       # show the derived version, change nothing
```

Zero-padded series (`1.6.9-rc03`) keep their padding. A tag with an ad-hoc suffix
(`1.1.3-rc4-health`) is ambiguous to increment, so it is refused rather than guessed —
pass `--target-version` there.

### Several repos at once

```bash
vast release VastPayPwaV2 VastPayPwa    # as if each had its own terminal
vast release --frontend                 # the six frontend repos
vast release --backend                  # the two backend repos
vast release --all                      # both trains, eight repos
```

The frontend train is VastMenu-DashBoard, VastMenuPwa, VastMenuPwaV2, VastPayPwa,
VastPayPwaV2 and VastPay-DashBoard; the backend train is VastPay-BackEnd and
VastMenu-BackEnd. `--all` is both, and `--frontend --backend` together means the same.
`vast-menu-payments` is in neither train — it is released only when you name it
(`vast release vast-menu-payments`), while still being cloned by `vast clone --team
frontend` and still showing in `vast status --all`. Repository names cannot be combined
with a sweep flag. A repo you have not cloned is skipped in a sweep, and only fails when
you name it.

Each repo is promoted and dispatched in turn — seconds of local `git` and `gh` — and
then every CI run is watched **at the same time**, so the whole thing takes about one
build instead of one per repo. Whichever build finishes first moves straight on to its
own ArgoCD wait. One repo refusing (a conflict, a dirty tree) never stops the others; the
summary lists every outcome and the command exits non-zero if any failed.

Every release, one repo or eight, runs on the same status block. Each watched repo owns
one line, rewritten in place as it goes:

```
  VastMenu-DashBoard  run 33633763604  in_progress  1m05s
  VastPayPwa          run 33633763712  queued       1m05s
```

The elapsed time refreshes on every status check. When a build finishes, that repo's line
hands over to the ArgoCD wait (`argocd vastpay-pwa  waiting for 2.1.4-rc3`) and ends at
`Synced/Healthy` with the app URL; a failed run's line becomes `failed  8m12s  <run URL>`.
Lines longer than the terminal width are cut to fit — the full detail, including the URL,
is in the summary below the block.

When the output is piped there is no cursor to move, so the CLI appends one line per
status change instead, plus a heartbeat every 30 seconds. That is what the `/release`
Claude skill sees.

Status is checked every 5 seconds for up to five runs, then one second slower per run
beyond that, so an eight-repo `--all` sweep checks every 8 seconds — a full sweep stays
well inside GitHub's API allowance. A read that fails prints `status read failed,
retrying` once per streak and polling carries on; only twelve failures in a row, about a
minute, report that repo as failed. The ArgoCD wait behaves the same way.

Names resolve in any casing, in the order typed, and duplicates collapse. An unknown
name anywhere refuses the whole command before anything runs. `--bump`,
`--skip-promote` and `--dry-run` apply to every repo; `--target-version` and `--dir`
are per-repo and are refused with a sweep flag (`--all`, `--frontend`, `--backend`) or
with more than one repo — one name repeated in another casing is still a single repo, so
it is still accepted.

### Production

**Production deploys are blocked in this version.** Production has not moved to the GitOps
pipeline yet, so `vast deploy --to production`, `vast workflow --branch production` and
even `vast production enable` refuse and say so. Lifting the lock is not a way around it —
the block sits in front of the lock.

Preparing a release still works, because it ships nothing:

```bash
vast promote VastPayPwa --to production              # cut release/X.Y.Z + PR
vast promote VastPayPwa --to production --as hotfix  # hotfix/X.Y.Z instead
# review and merge that PR — a human, as always
```

When DevOps migrates production, the block is lifted in a CLI release and the old two-step
returns: `vast production enable` to lift the deploy lock, then
`vast deploy VastPayPwa --to production`.

Beyond all of that, this CLI never pushes to `production`, `prod`, `main` or `master` at
all. Production is reached only by merging the reviewed release PR, which a human does.
`vast workflow` refuses those four branch names outright — any casing, spaces trimmed —
before it even dry-runs, so the raw-dispatch escape hatch is not one.

### Shipping only some of staging

Sometimes staging carries more than you want to release. `--pick` cuts the branch from
production and cherry-picks only the changes you name — everything else stays behind:

```bash
vast promote VastPayPwa --to production --pick 812 c51404cb   # defaults to --as hotfix
```

| A pick can be | Example |
|---|---|
| Commit SHA (needs a letter) | `c51404cb` |
| Merge-commit SHA | same — `-m 1` applied automatically |
| PR number | `812` or `#812` |
| PR link | `https://github.com/Vast-menu/VastPayPwa/pull/812` |
| Commit link | `https://github.com/Vast-menu/VastPayPwa/commit/c51404cb` |
| Branch name | `fix/urgent-thing` |
| Branch link | `https://github.com/Vast-menu/VastPayPwa/tree/fix/urgent-thing` |

A bare number is always a PR number, never a short SHA. Picks apply in history order
regardless of the order you type them, and a conflict aborts everything — branch deleted,
checkout untouched.

**A branch pick is handled by where the branch came from**, because a git merge brings a
branch's entire ancestry, not just its own work:

- **Cut from production** (a true emergency-fix branch) → genuinely merged. Its commits
  skipped staging, so this prints a loud QC warning and, after the PR opens, a reminder
  to port the fix back to develop/staging.
- **Already landed on staging** → the tool uses its landing merge commit instead, exactly
  as if you had picked the PR. No double-merge, all safety rules hold.
- **Floating off develop/staging, not landed** → refused, with the number of foreign
  commits a merge would have dragged in. Land it on staging first, or pick exact commits.

The dry run states which treatment each branch gets. Branches are always fetched fresh
before anything happens.

Rules that keep this safe: every pick must already be on `staging` (production only ever
receives staging-baked changes) and must not already be on `production`. The version
advances production's own tag (`2.2.2 → 2.2.3`) rather than borrowing staging's — read
from `Vast-deployments` when a production file is there and otherwise from the app repo's
`Helm/values-prod.yaml` on `origin/production`, and `promote` prints which of the two it
used, so a surprising version number can always be traced to its source. Deploying
afterwards is explicit:

```bash
vast deploy VastPayPwa --to production --target-version 2.2.3   # blocked until production migrates
```

`--pick` works with `--as release` and `--as hotfix` alike; it just defaults to hotfix.
Deploy's safety gate asks the same question in both flows: **is `release/X.Y.Z` or
`hotfix/X.Y.Z` merged into production?** — so a selective release does not need staging
to be fully shipped first.

The release PR's description is built from the commit subjects being promoted, grouped
into Features / Fixes / Improvements / Maintenance. `--summarize` instead has a small
local model read the diff (slower, not reproducible); `--no-changelog` gives a bare
one-liner.

## Claude Code skill

The CLI does everything deterministic. The `/release` skill takes over where determinism
runs out — merge conflicts, failed deploys, and writing release notes for QC.

```bash
mkdir -p ~/.claude/skills/release
curl -fsSL https://raw.githubusercontent.com/MostafaAdly/vast-cli/main/skills/release/SKILL.md -o ~/.claude/skills/release/SKILL.md
curl -fsSL https://raw.githubusercontent.com/MostafaAdly/vast-cli/main/skills/release/notes.sh -o ~/.claude/skills/release/notes.sh
chmod +x ~/.claude/skills/release/notes.sh
```

Then in Claude Code:

```
/release VastPayPwa                  promote + deploy to staging
/release VastPayPwa --to production  cut the release PR (never deploys)
/release triage VastPayPwa           diagnose the last failed run
/release notes VastPayPwa            draft QC notes only
```

**What it will and will not do.** It always dry-runs first and reports what it found. On a
conflict it explains both sides and proposes a diff, then **stops for your approval** —
and treats payment paths as requiring approval even when the fix looks obvious. On a
failed deploy it diagnoses before retrying, and re-dispatches the *same* version rather
than burning a new rc on a flake.

It never pushes to a protected branch, never merges a release PR, and never lifts the
production lock — it tells you the command and lets you run it.

The skill source lives in this repo under [`skills/release/`](skills/release), so it stays
in step with the CLI it drives.

## Repositories

Twelve repos are configured. Nine are **releasable** — a repo is releasable when it has
both a `build-deploy` workflow and a staging values file in `Vast-deployments`, which is
derived, not declared:

| Repo | Team | Releasable | Release train |
|---|---|---|---|
| VastPayPwa, VastPayPwaV2, VastPay-DashBoard | frontend | ✅ | `--frontend` |
| VastMenuPwa, VastMenuPwaV2, VastMenu-DashBoard | frontend | ✅ | `--frontend` |
| vast-menu-payments | frontend | ✅ | none — release it by name |
| Vast-Finance | frontend | ❌ no workflow or deployments file | — |
| VastPay-BackEnd, VastMenu-BackEnd | backend | ✅ | `--backend` |
| vastpay-payment-odoo | backend | ❌ | — |
| Terraform | infra | ❌ | — |

Each releasable repo has its own folder under `deployments/helm/staging/` in
`Vast-deployments`, and the folder name is also its ArgoCD application name. They do not
match the repo names, so this is the map:

| Repo | ArgoCD app / folder |
|---|---|
| VastPayPwa | `vastpay-pwa` |
| VastPayPwaV2 | `vastpay-pwa-v2` |
| VastPay-DashBoard | `vastpay-dasaboard` (spelling is theirs — do not "fix" it) |
| VastMenuPwa | `pwa` |
| VastMenuPwaV2 | `pwav2` |
| VastMenu-DashBoard | `vastmenu-dashboard` |
| vast-menu-payments | `vastmenu-payments` |
| VastPay-BackEnd | `vastpay-backend` |
| VastMenu-BackEnd | `vastmenu-backend` |

Unreleasable repos can be cloned but never appear in `status --all`, and cannot be
promoted or deployed.

The two `*-BackEnd` repos have no usable `develop` — human PRs there target `staging`
directly — so `promote --to staging` refuses on them rather than regressing the branch.
`vast release` knows this and skips the promotion step for them automatically, deploying
what is already on staging.

## Configuration

Everything lives in `~/.vast-cli/`:

| File | Purpose |
|---|---|
| `config.json` | Repo→path map and the roots discovery learned from |
| `argocd/<env>.json` | Your ArgoCD session token for that environment, plus the load-balancer session cookie that gets the CLI past the browser sign-in, written mode `0600` |
| `production-enabled` | The production lock. Its presence is the only thing permitting a production deploy |
| `version` | The installed release tag |
| `update-check.json` | Cached result of the daily release check |

`argocd/staging.json` holds a **session token**, never your password — `vast argocd login`
exchanges the password for a token and forgets the password. Alongside it sits the
load-balancer session cookie you pasted, which the CLI sends on every ArgoCD request.
`vast argocd status` reports whether a token is stored and whether ArgoCD still accepts it,
and whether a cookie is stored — `Cookie: present (saved <date>)` or `Cookie: none`. It
never prints either value. `vast argocd logout` deletes the file, clearing both. For CI or
a throwaway shell, set `VAST_ARGOCD_TOKEN_STAGING` and `VAST_ARGOCD_ALB_COOKIE_STAGING`
and they win over the file, with nothing written to disk.

Every `vast init` searches the default locations, your saved roots, and your current
directory — so a repo cloned into a normal place is always picked up, with no flag.
Use `vast init --root <path>` to teach it somewhere unusual; named roots are saved, so
you pass them once.

`vast init --rescan` forgets previously saved roots while keeping the defaults, for when
you have reorganised and old locations no longer matter.

If a repo has more than one checkout, `init` asks which to use and remembers the answer.
Later runs keep that choice rather than re-picking, even when they find the other copy.

### When ArgoCD sits behind a browser sign-in

`argocd-stg.vastmenu.com` is behind an AWS load balancer that demands a Google sign-in on
every path, `/api/*` and `/login` included. A browser that has signed in once holds a
cookie that gets past it; the CLI cannot obtain that cookie itself, so you hand it over
once and it reuses it:

1. Open `https://argocd-stg.vastmenu.com` in your browser and sign in with Google.
2. Open DevTools → Application → Cookies → the ArgoCD host.
3. Copy the value of `AWSELBAuthSessionCookie-0`.
4. Run `vast argocd login`. It notices the sign-in wall and asks for the cookie first —
   paste it (the input is hidden, and a whole `Cookie:` header line works too; only the
   `AWSELBAuthSessionCookie*` pairs are kept). Then enter your ArgoCD username and password
   as usual.

The cookie is stored next to your token in `~/.vast-cli/argocd/staging.json`, mode `0600`,
and lasts about a week. When it expires, deploys stop confirming rollouts and the CLI asks
you for a fresh one — repeat the four steps. The permanent fix is DevOps': exempt `/api/*`
from the sign-in rule, and the cookie step disappears.

---

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `vast: command not found` | `~/.local/bin` is not on your `PATH`. The installer prints the exact line for your shell; add it and open a new terminal. |
| Everything fails against GitHub | `gh auth status` — every command goes through `gh`. Fix with `gh auth login`. |
| `vast init` finds nothing | Your repos are outside the searched locations. Point at them: `vast init --root /path/to/repos`. The path is remembered. |
| A repo shows `not cloned` | You do not have it. `vast clone --team <yours>`, or `vast init` if it is checked out somewhere `vast` has not seen. |
| `not cloned` for a repo you *do* have | It moved. `vast init --rescan`, or `vast init --root <new path>`. |
| `promote` refuses: uncommitted changes | Commit or stash first. It will not merge over a dirty tree. |
| `promote` refuses: conflicts | Real conflict. Nothing was changed. Resolve it, or use `/release` to have Claude explain both sides. |
| `Unparseable version tag` | The repo ships a tag like `1.1.3-rc4-health`, ambiguous to increment. Pass `--target-version X.Y.Z`. |
| `tag committed — rollout not confirmed (no ArgoCD token)` | The build ran and the tag was committed, but you have never logged in on this machine (or you logged out), so the CLI could not watch ArgoCD. The rollout is almost certainly happening — check the app in ArgoCD, or run `vast argocd login` so the next deploy is confirmed for you. |
| `ArgoCD's API is behind a browser sign-in (SSO)` / `tag committed — rollout not confirmed (ArgoCD API behind SSO)` | The ArgoCD host sits behind a load-balancer Google sign-in that covers every path, including `/api/*`, and the CLI has no session cookie to get past it. Sign in to `https://argocd-stg.vastmenu.com` in your browser, copy the `AWSELBAuthSessionCookie-0` value from DevTools → Application → Cookies, and run `vast argocd login` — it asks for the cookie, then for your ArgoCD username and password. Full steps: [When ArgoCD sits behind a browser sign-in](#when-argocd-sits-behind-a-browser-sign-in). **Deploys still work** meanwhile — the build runs and the tag is committed; only the rollout confirmation is skipped, and you can watch it in the ArgoCD UI. The permanent fix is DevOps': exempt `/api/*` from the sign-in rule (ArgoCD's own login still protects the API), and the cookie step goes away. |
| `tag committed — rollout not confirmed (ArgoCD session cookie expired — run vast argocd login again)` | Your load-balancer session cookie has aged out — it lasts about a week — so the CLI hit the sign-in wall again and skipped the rollout wait. Nothing failed: the build ran and the tag was committed. Grab a fresh cookie from the browser and run `vast argocd login` again, and the next deploy is confirmed for you. Do not re-run the deploy to "make it green". |
| `argocd unauthorized` | The stored token expired or was revoked. `vast argocd login` again. **Nothing was built** — the CLI reads the application once before dispatching, so an expired token stops it in front of the build, not after it. Then run the deploy again as you meant to. |
| `timed out after 15m00s` | The build and the tag commit succeeded; ArgoCD had not reported Synced/Healthy within 15 minutes. Open the app URL in the summary and look there. Do not release a new rc — nothing is wrong with the version. On a **retry of a version that is already live**, this can instead mean the rebuild committed nothing new to `Vast-deployments`, so there was no new sync to wait for; the summary says which of the two it was. |
| `failed committing the tag — image may already be built` | The workflow built the image but failed writing the tag into `Vast-deployments`. Re-run the deploy with the **same** version; the rebuild is cheap and nothing else has moved. Because that tag may already be running, the retry waits for a **new** ArgoCD sync rather than accepting the rollout that is already there — so it will not report a stale success, and it times out after 15 minutes if the rebuild produces no new commit. |
| Every `STAGING` and `PRODUCTION` cell reads `not migrated` or `?` | Your GitHub account cannot read `Vast-deployments`. A private repo you cannot see answers 404, which is indistinguishable from a missing file, so every lookup fails the same way. Ask DevOps for access. One repo showing `not migrated` on its own is the ordinary unmigrated case, not this. |
| `dispatched, but its run could not be identified` | The build was triggered; the CLI could not match it to a run id, so it cannot watch it. Open the repo's Actions page and see whether it is running **before** re-dispatching — re-running blind starts a second build of the same version. |
| Production deploy refuses: not migrated | Expected. Production has not moved to the GitOps pipeline, so deploys are blocked and `vast production enable` refuses too. `vast promote --to production` still cuts the release PR. |
| `vast upgrade` installs the previous version | GitHub's releases API is cached for ~60s. Wait a minute after publishing. |
| `status --all` is slow | It fetches every repo. `--no-fetch` reads local refs instantly, at the cost of possible staleness. |

Still stuck? `vast <command> --help` carries worked examples for every command.

## Development

```bash
npm test          # node:test suite (282 tests)
npm run typecheck # tsc --noEmit
npm run build     # regenerate src/version.ts, then tsc
npm run bundle    # single-file ESM bundle for a release
npm run dev       # run TypeScript directly via tsx
```

`bin/vast.js` loads from `dist/`, which is committed, so **rebuild before testing the CLI
manually** or you will be running stale code.

### Releasing

```bash
npm version <patch|minor|major> && git push --follow-tags
```

The tag triggers CI, which runs the suite and typecheck **before** building, verifies the
bundle executes, checks the tag matches `package.json`, and attaches `vast.mjs` to a new
release. A tag whose tests fail produces no release — better none than one that installs a
broken CLI over everyone's working copy.

`src/version.ts` is generated from `package.json` and staged automatically by the `version`
lifecycle hook, so the tag is always self-consistent. The same hook rebuilds and stages
`dist/`, so a fresh clone at a tag reports that tag's version.

> `install.sh` is served from `main`, not from a release, so installer fixes take effect
> without a version bump — once GitHub's raw CDN expires its cache, usually a few minutes.

### Layout

- `src/commands/` — one file per command, each exporting `register<Name>Command()`
- `src/config/` — the repo list, the per-user config, the production lock, ArgoCD hosts and tokens
- `src/utils/` — git, GitHub, the Vast-deployments reader, the ArgoCD client, version derivation, discovery, UI
- `tests/` — one file per module, run with Node's built-in test runner

New commands are registered in `src/cli.ts`; anything registered there appears in
`vast --help`.

The bundle is ESM and ships as **`.mjs`**, deliberately. Node 22 sniffs module syntax in a
`.js` file but Node 18 and 20 do not, and would fail with
`Cannot use import statement outside a module`.

## License

[MIT](LICENSE) © Mostafa Adly
