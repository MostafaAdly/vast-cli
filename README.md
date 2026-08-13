# Vast CLI

Release tooling for Vast Group. Replaces the hand-run `develop → staging → production`
ritual with a few commands, and derives version numbers from what is actually deployed
rather than from memory.

```bash
vast status --all          # what is live everywhere
vast release VastPayPwa    # develop → staging, versioned, deployed, bump PR merged
```

## Prerequisites

- **Node.js ≥ 18**
- **git ≥ 2.38** — conflict detection uses `git merge-tree --write-tree`
- **[GitHub CLI](https://cli.github.com/) (`gh`), authenticated** — run `gh auth status` to check.
  Every command shells out to `gh`; nothing works without it.
- Access to the Vast-menu organisation

## Install

There is no one-line installer yet — that is planned, but today you clone and link:

```bash
gh repo clone MostafaAdly/vast-cli ~/tools/vast-cli
cd ~/tools/vast-cli
npm install
npm run build
npm link
```

`npm link` puts a `vast` executable on your `PATH` pointing at the checkout, so
`git pull && npm run build` is all an update takes.

Then tell it where your repos are:

```bash
vast init
```

It scans your disk for Vast checkouts and remembers where each one lives. It matches
repos by their `origin` remote, not by folder name, so it does not matter what you
called them or where you put them — including in several different places.

Missing some? Clone what your team needs:

```bash
vast clone --team frontend    # or backend, infra, all
```

## Uninstall

```bash
npm rm -g vast-cli            # removes the `vast` command
rm -rf ~/.vast-cli            # config and the production lock
rm -rf ~/tools/vast-cli       # the checkout itself
```

Nothing else is left behind. The CLI never writes outside `~/.vast-cli` except when
you explicitly ask `vast clone` to put a repo somewhere.

## Commands

Run `vast` with no arguments for the same overview, and `vast <command> --help` for
options and worked examples.

| Command | What it does |
|---|---|
| `vast init` | Find your checkouts and remember where they are |
| `vast clone` | Clone the repos your team needs |
| `vast status` | Deployed versions and branch drift |
| `vast release` | Promote develop→staging, derive the version, deploy, merge the bump PR |
| `vast promote` | Merge branches, or open a release/hotfix PR into production |
| `vast deploy` | Ship a version already on the branch |
| `vast workflow` | Trigger a raw GitHub Actions workflow |
| `vast production` | Show or change the production deploy lock |

### The everyday flow

```
develop  ──▶  staging  ──▶  production
           vast release    vast promote --to production
                           vast deploy  --to production
```

### Versions are derived, not typed

The next version comes from the tag currently deployed, read out of the repo's Helm
values — so it reflects what everyone has deployed, not what you remember deploying.

```bash
vast release VastPayPwa                 # 1.5.5-rc15 → 1.5.5-rc16   continue the series
vast release VastPayPwa --bump patch    # 1.5.5-rc15 → 1.5.6-rc1
vast release VastPayPwa --bump minor    # 1.5.5-rc15 → 1.6.0-rc1
vast release VastPayPwa --bump major    # 1.5.5-rc15 → 2.0.0-rc1
vast release VastPayPwa --dry-run       # show the derived version, change nothing
```

Zero-padded series (`1.6.9-rc03`) keep their padding. A tag with an ad-hoc suffix
(`1.1.3-rc4-health`) is ambiguous to increment, so it is refused rather than guessed —
pass `--target-version` in that case.

### Production

Production deploys are **locked by default**:

```bash
vast promote VastPayPwa --to production              # cut release/X.Y.Z + PR — works while locked
vast promote VastPayPwa --to production --as hotfix  # hotfix/X.Y.Z instead
# review and merge that PR
vast production enable                               # lift the deploy lock
vast deploy VastPayPwa --to production               # build and ship
```

Preparing a release ships nothing, so it is never gated. Only the deploy is. Beyond
the lock, this CLI never pushes to `production`, `prod`, `main`, or `master` at all —
production is reached only by merging the reviewed release PR, which a human does.

The release PR's description is built from the commit subjects being promoted, grouped
into Features / Fixes / Improvements / Maintenance. `--summarize` instead has a small
local model read the diff (slower, not reproducible); `--no-changelog` gives a bare
one-liner.

## Repositories

Twelve repos are configured. Nine are releasable — a repo is releasable when it has
both a deploy workflow and staging Helm values, which is derived, not declared:

| Repo | Teams | Releasable |
|---|---|---|
| VastPayPwa, VastPayPwaV2, VastPay-DashBoard | frontend | yes |
| VastMenuPwa, VastMenuPwaV2, VastMenu-DashBoard | frontend | yes |
| vast-menu-payments | frontend | yes |
| Vast-Finance | frontend | no — no workflow or Helm values |
| VastPay-BackEnd, VastMenu-BackEnd | backend | yes |
| vastpay-payment-odoo | backend | no |
| Terraform | infra | no |

Unreleasable repos can be cloned but never appear in `status --all` and cannot be
promoted or deployed.

The two `*-BackEnd` repos have no usable `develop` — human PRs there target `staging`
directly — so `promote --to staging` refuses on them rather than regressing the branch.

## Configuration

`~/.vast-cli/config.json` holds the repo→path map and the roots discovery learned from.
Re-scan with `vast init --rescan` after moving a repo somewhere new.

`~/.vast-cli/production-enabled` is the production lock. Its presence is the only thing
that permits a production deploy; `vast production status` reports it.

## Development

```bash
npm test          # node:test suite
npm run typecheck # tsc --noEmit
npm run build     # tsc — required before bin/vast.js sees your changes
npm run dev       # run TypeScript directly via tsx
```

`bin/vast.js` loads from `dist/`, which is committed, so **rebuild before testing the
CLI manually** or you will be running stale code.

### Layout

- `src/commands/` — one file per command, each exporting `register<Name>Command()`
- `src/config/` — the repo list, the per-user config, the production lock
- `src/utils/` — git, GitHub, Helm, version derivation, discovery, UI
- `tests/` — one file per module, run with Node's built-in test runner

New commands are registered in `src/cli.ts`; anything registered there appears in
`vast --help`.
