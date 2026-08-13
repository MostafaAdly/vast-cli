# Vast CLI

[![release](https://img.shields.io/github/v/release/MostafaAdly/vast-cli?label=release)](https://github.com/MostafaAdly/vast-cli/releases/latest)
[![node](https://img.shields.io/badge/node-%E2%89%A518-brightgreen)](https://nodejs.org)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

Release tooling for Vast Group. Replaces the hand-run `develop → staging → production`
ritual with a few commands, and derives version numbers from what is actually deployed
rather than from memory.

```bash
vast status --all          # what is live everywhere
vast release VastPayPwa    # develop → staging, versioned, deployed, bump PR merged
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

## Commands

Run `vast` with no arguments for an overview, and `vast <command> --help` for options and
worked examples.

| Command | What it does |
|---|---|
| `vast init` | Find your checkouts and remember where they are |
| `vast clone` | Clone the repos your team needs |
| `vast upgrade` | Update to the latest release |
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

Every promotion fetches first, then fast-forwards your local branches to match, reporting
what it pulled:

```
pulled 24 new commit(s) into develop
```

A branch carrying local commits is reported and left alone rather than rewritten — the
promotion merges `origin/*` regardless, so your work is never at risk.

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
pass `--target-version` there.

### Production

Production deploys are **locked by default**:

```bash
vast promote VastPayPwa --to production              # cut release/X.Y.Z + PR — works while locked
vast promote VastPayPwa --to production --as hotfix  # hotfix/X.Y.Z instead
# review and merge that PR
vast production enable                               # lift the deploy lock
vast deploy VastPayPwa --to production               # build and ship
```

Preparing a release ships nothing, so it is never gated — only the deploy is. Beyond the
lock, this CLI never pushes to `production`, `prod`, `main` or `master` at all. Production
is reached only by merging the reviewed release PR, which a human does.

The release PR's description is built from the commit subjects being promoted, grouped
into Features / Fixes / Improvements / Maintenance. `--summarize` instead has a small
local model read the diff (slower, not reproducible); `--no-changelog` gives a bare
one-liner.

## Repositories

Twelve repos are configured. Nine are **releasable** — a repo is releasable when it has
both a deploy workflow and staging Helm values, which is derived, not declared:

| Repo | Team | Releasable |
|---|---|---|
| VastPayPwa, VastPayPwaV2, VastPay-DashBoard | frontend | ✅ |
| VastMenuPwa, VastMenuPwaV2, VastMenu-DashBoard | frontend | ✅ |
| vast-menu-payments | frontend | ✅ |
| Vast-Finance | frontend | ❌ no workflow or Helm values |
| VastPay-BackEnd, VastMenu-BackEnd | backend | ✅ |
| vastpay-payment-odoo | backend | ❌ |
| Terraform | infra | ❌ |

Unreleasable repos can be cloned but never appear in `status --all`, and cannot be
promoted or deployed.

The two `*-BackEnd` repos have no usable `develop` — human PRs there target `staging`
directly — so `promote --to staging` refuses on them rather than regressing the branch.

## Configuration

Everything lives in `~/.vast-cli/`:

| File | Purpose |
|---|---|
| `config.json` | Repo→path map and the roots discovery learned from |
| `production-enabled` | The production lock. Its presence is the only thing permitting a production deploy |
| `version` | The installed release tag |
| `update-check.json` | Cached result of the daily release check |

Re-scan with `vast init --rescan` after moving a repo somewhere new.

---

## Development

```bash
npm test          # node:test suite (168 tests)
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
lifecycle hook, so the tag is always self-consistent.

> `install.sh` is served from `main`, not from a release, so installer fixes take effect
> without a version bump — once GitHub's raw CDN expires its cache, usually a few minutes.

### Layout

- `src/commands/` — one file per command, each exporting `register<Name>Command()`
- `src/config/` — the repo list, the per-user config, the production lock
- `src/utils/` — git, GitHub, Helm, version derivation, discovery, UI
- `tests/` — one file per module, run with Node's built-in test runner

New commands are registered in `src/cli.ts`; anything registered there appears in
`vast --help`.

The bundle is ESM and ships as **`.mjs`**, deliberately. Node 22 sniffs module syntax in a
`.js` file but Node 18 and 20 do not, and would fail with
`Cannot use import statement outside a module`.

## License

[MIT](LICENSE) © Mostafa Adly
