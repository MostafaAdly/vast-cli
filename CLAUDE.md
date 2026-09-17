# CLAUDE.md

Guidance for Claude Code when working in this repository.

vast-cli is release tooling for Vast Group: TypeScript (strict, NodeNext ESM),
Commander, Node ≥ 18. It shells out to `git` and `gh` for everything — nothing
works without an authenticated `gh`.

## Hard rules

- **Docs ship with the change.** Any change to commands, flags, install or
  uninstall, config paths, or the release process updates `README.md` and
  `skills/release/SKILL.md` **in the same PR** — never as a follow-up. Before
  committing, verify every documented command and flag against the running CLI
  (`node bin/vast.js <cmd> --help`); do not document from memory. This repo's
  README drifted badly twice by skipping that check.
- **`dist/` is committed on purpose** — `bin/vast.js` loads from it so the CLI
  runs straight from a clone. Run `npm run build` before manually testing or
  you are testing stale code, and commit the rebuilt `dist/` with source changes.
  The `version` lifecycle hook rebuilds `dist/` too, so a tag never ships a
  stale dist.
- **`src/version.ts` is generated** from `package.json` by
  `scripts/sync-version.mjs`. Never hand-edit it; `npm version <level>`
  regenerates it, rebuilds `dist/`, and stages both via the `version` lifecycle
  hook.
- **The release bundle ships as `vast.mjs`, never `.js`.** Node 18 and 20 cannot
  detect ESM in a `.js` file and fail with "Cannot use import statement outside
  a module". Do not rename it anywhere: bundle script, workflow, installer.
- **No AI attribution in commit messages.** No `Co-Authored-By`, no
  "Generated with" lines.
- Relative imports carry a `.js` extension even though sources are `.ts`
  (NodeNext resolution).
- No new runtime dependencies without explicit approval from Mostafa.

## Commands

```bash
npm test           # node:test suite — must be green before every commit
npm run typecheck  # tsc --noEmit — same
npm run build      # regenerate src/version.ts, then tsc -> dist/
npm run bundle     # single-file build/vast.mjs, the release artifact
npm run dev        # run TypeScript directly via tsx
```

## Testing conventions

- All config I/O is sandboxed through `VAST_CLI_HOME`, set **before** importing
  the module under test — see `tests/production-lock.test.ts` for the pattern.
  A test must never touch the real `~/.vast-cli`; a crashed test could
  otherwise leave the real production lock lifted.
- Git behaviour is tested against real fixture repos built with `git init`
  (and a local bare repo when a real `origin` is needed) — not mocks.
- `vast init` tests run against an empty `HOME` (see `runInit` in
  `tests/init.test.ts`): every scan sweeps the default roots, so fixtures using
  real Vast origins would otherwise collide with genuine checkouts on the
  developer's machine.
- `git log --merges` matches on parent count, not subject text — fixtures that
  need merge commits must create real ones (`git merge --no-ff`), not
  `--allow-empty` commits that merely look like merges.

## Releasing this CLI

```bash
npm version <patch|minor|major> && git push --follow-tags
```

CI then runs the suite and typecheck, verifies the bundle executes, refuses if
the tag and `package.json` disagree, and attaches `vast.mjs` to a new release.

- GitHub's releases API caches "latest" for ~60 seconds — `vast upgrade`
  immediately after publishing may install the previous version. Wait it out.
- `install.sh` is served from `main`, not from a release: installer fixes take
  effect without a version bump once the raw CDN cache expires.
- When watching a release run, select it by tag
  (`gh run list --json headBranch` filtered to the tag) — `--limit 1` races the
  trigger and returns the previous run.

## The /release skill

`skills/release/` is the source of truth. Users install it by downloading raw
files, so installed copies under `~/.claude/skills/` are snapshots — edit the
repo copy, and users re-download to update. Its helper's tests live in
`tests/notes.test.ts`. The skill must never reference private paths
(`vast-routines`, personal tokens); it once did and was unusable by anyone else.

## The deploy pipeline (staging is GitOps)

Nothing reads Helm values out of the app repos any more. The deployed tag lives
in `Vast-deployments`:

- Staging: `deployments/helm/staging/<app>/stage.yaml`, read at `main` through
  `gh api .../contents/<path>`. Production (not migrated yet):
  `deployments/helm/production/<RepoName>/prod.yaml`.
- The tag is `deployment.containers[0].image.tag` — the first `tag:` line in the
  file. `extractTag` in `src/utils/helm.ts` still parses it; the reader is
  `src/utils/deployments.ts`.
- The folder basename is also the ArgoCD application name, and it does **not**
  match the repo name: `VastPayPwa → vastpay-pwa`, `VastMenuPwa → pwa`,
  `VastMenuPwaV2 → pwav2`, `VastPay-DashBoard → vastpay-dasaboard` (their typo,
  upstream — never "fix" it).
- Each repo dispatches its own `build-deploy` workflow, one `version` input, on
  the env branch. It builds the image and commits the tag to `Vast-deployments`;
  ArgoCD syncs from there, usually within ~3 minutes. There are no bump PRs.
- A deploy is not done when the workflow goes green — that only means the tag was
  committed. It is done when ArgoCD reports `Synced/Healthy` on an image carrying
  the tag. Ceiling 10 minutes.
- `vast argocd login` stores a session token in `~/.vast-cli/argocd/<env>.json`,
  mode 0600, never a password. `VAST_ARGOCD_TOKEN_<ENV>` overrides it. Tests must
  keep this under `VAST_CLI_HOME` like every other config path.

## Gotchas

- VastPayPwa's seed tag in `Vast-deployments` is `5.0.1`, left by a DevOps test
  deploy, while its real series was `1.5.6-rc7`. Version derivation will happily
  continue from `5.0.1`. That is a human decision, not something to paper over in
  code — ask Mostafa before releasing that repo.

## Safety invariants — do not weaken

- The CLI never pushes to `production`, `prod`, `main`, or `master`
  (`NEVER_PUSH` in `src/utils/git.ts`), independent of any other setting.
- Production deploys are hard-blocked by `PRODUCTION_PIPELINE_READY` in
  `src/config/production-lock.ts` until DevOps migrates production; do not flip
  it without verifying the production workflow inputs and the production folder
  names with DevOps. `vast production enable` refuses while it is false.
- Production deploys are locked by default (`src/config/production-lock.ts`).
  Preparing a release/hotfix PR is deliberately never gated by the lock, nor by
  the pipeline block.
- `promote` refuses on dirty working trees and real conflicts. The single
  auto-resolved conflict is `package.json`'s version line, which CI rewrites
  per-branch on every deploy; anything else refuses.
- `--pick` only accepts commits already reachable from `origin/staging` —
  production never receives changes QC could not have seen. The single, loudly
  warned exception: a branch pick whose branch was cut from production (a true
  emergency fix) is genuinely merged, and the user is reminded to port it back.
- The deploy gate requires `release/<v>` or `hotfix/<v>` to be an ancestor of
  `origin/production`: a human must have merged this version's PR.
