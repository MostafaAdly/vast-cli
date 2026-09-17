# GitOps deploys: design

Date: 2026-09-17. Status: approved in chat by Mostafa; production hard-blocked.

## Why

Staging moved to GitOps. ArgoCD reads `Vast-deployments` (`deployments/helm/staging/<app>/stage.yaml`),
the per-repo `build-deploy` workflow builds the image and commits the tag there, and there are no
bump PRs any more. The old ArgoCD Applications were deleted, so today's `vast release` merges a bump
PR into a file nothing watches and reports a green release that ships nothing. Production is not
migrated yet, but will follow the same shape.

## Facts verified on 2026-09-17

- `build-deploy` exists in all nine releasable repos. One `workflow_dispatch` input, `version`; the
  ref is the branch dispatched on. Concurrency group `deploy-staging-<repo>`. It calls a private
  shared action that clones Vast-deployments, `sed`s every `tag: "..."` in the file, commits
  `Update <Repo> staging image to <tag>` and pushes to `main` directly. The action has a
  "Create Pull Request (production only)" step, so production will be a PR later.
- Staging folder per repo (ArgoCD app name is the folder basename):
  VastPayPwa→vastpay-pwa, VastPayPwaV2→vastpay-pwa-v2, VastPay-DashBoard→vastpay-dasaboard (sic),
  VastMenuPwa→pwa, VastMenuPwaV2→pwav2, VastMenu-DashBoard→vastmenu-dashboard,
  vast-menu-payments→vastmenu-payments, VastPay-BackEnd→vastpay-backend,
  VastMenu-BackEnd→vastmenu-backend.
- Production folders that exist today use repo names (`VastMenu-BackEnd`, `vast-menu-payments`),
  file `prod.yaml`. The prod ApplicationSet is committed but marked "do not apply".
- Tag location in both files: `deployment.containers[0].image.tag`, first `tag:` line in the file.
- ArgoCD staging: `https://argocd-stg.vastmenu.com`, local accounts (no dex/oidc), API needs a
  session token. `argocd-prod.vastmenu.com` exists (403 from outside).
- Seed tags equal the old Helm tags for eight repos; VastPayPwa's file says `5.0.1` from a DevOps
  test deploy while its real series is `1.5.6-rc7`. Human decision, not code.

## Config model (`src/config/repos.ts`)

```ts
export type DeployEnv = 'staging' | 'production';
export interface RepoConfig {
  name: string;
  /** Workflow that builds the image and commits the tag, per env. null: not deployable there. */
  workflow: { staging: string | null; production: string | null };
  /** Values file in Vast-deployments holding the deployed tag, per env. null: not deployed there. */
  deployments: { staging: string | null; production: string | null };
  promoteFrom: { staging: string | null; production: string | null };
  teams: string[];
  releaseTeam: ReleaseTeam | null;
}
export function deploymentsFile(repo, env): string | null;   // repo.deployments[env]
export function argoApp(repo, env): string | null;           // basename of the file's directory
export function isReleasable(repo): boolean;                 // workflow.staging && deployments.staging
```

Staging: `deployments/helm/staging/<folder>/stage.yaml`, workflow `build-deploy`.
Production: `deployments/helm/production/<RepoName>/prod.yaml`, workflow `build-deploy`. Both are
assumptions until DevOps migrates production; they sit behind the hard block below. The `helm`
field and the app-repo `Helm/values-*.yaml` reads are removed.

## Version source (`src/utils/deployments.ts`)

`deployedTag(repo, env, fetchFile?)` reads the file from `Vast-menu/Vast-deployments@main` through
`gh api .../contents/<path>?ref=main` (base64 content), parses with the existing `extractTag`. A
missing file throws `no <path> in Vast-deployments`. `status`, `release`, `deploy`, and
`promote --to production` (release version = stripped staging tag; hotfix version = production tag
+ patch) all derive from here. Nothing reads Helm from the app checkouts any more.

## ArgoCD (`src/config/argocd.ts`, `src/utils/argocd.ts`, `src/commands/argocd.ts`)

- Hosts: staging `https://argocd-stg.vastmenu.com`, production `https://argocd-prod.vastmenu.com`,
  overridable per env in `~/.vast-cli/argocd/<env>.json` (`host`).
- Token: `VAST_ARGOCD_TOKEN_<STAGING|PRODUCTION>` env var wins; else `token` from the same file,
  written with mode 0600. Never the password. All I/O under `VAST_CLI_HOME`.
- `vast argocd login [--to staging|production] [--username <u>]`: prompts username and hidden
  password, `POST /api/v1/session`, stores the token. `vast argocd status`: per env, whether a token
  is stored and whether `GET /api/v1/session/userinfo` says it is still valid. `vast argocd logout
  [--to env]` removes the file.
- Client uses Node's global `fetch` (Node ≥ 18, no new dependency). `getApplication(host, token,
  app)` returns `{ syncStatus, healthStatus, images, revision }` from `status.sync.status`,
  `status.health.status`, `status.summary.images`, `status.sync.revision`. A 401/403 throws
  `ArgoUnauthorizedError`.
- `waitForRollout(label, app, tag, deps, timing)`: polls `getApplication` until an image ends with
  `:<tag>` AND health `Healthy` AND sync `Synced`. Prints on change and on heartbeat in pollRun's
  shape: `  <label>  argocd <app>  <sync>/<health>  <elapsed>`; the tag-not-yet-seen state prints
  as `waiting for <tag>`. Ceiling 10 minutes → `{ ok: false, reason: 'timed out' }`.
  Unauthorized → `{ ok: false, reason: 'argocd unauthorized — run `vast argocd login`' }`. Other
  read errors count like pollRun (12 consecutive → give up). Fully injectable; tested with a fake
  `getApplication` and a local `http` server for the real client.

## Deploy, one path for both envs (`src/commands/deploy.ts`)

`deployOne(repo, env, version, dryRun, slot, timing)`:
1. Dispatch `repo.workflow[env]` on branch `env` with `version` (existing `runWorkflow`).
2. `pollRun` the run onto the repo's board line (existing).
3. If the run failed: if the failed step name contains `update-helm`, detail =
   `run <id> failed committing the tag — image may already be built — <url>`; else as today.
4. `waitForRollout` onto the same line. Success line:
   `  <label>  argocd <app>  Synced/Healthy  <took>  <host>/applications/<app>`.
   Outcome `released`, detail `<tag> live on <app> — <argocd url>`.
5. Dry run stops after the version is printed, as today.
The board is used for one repo too; the blocking `gh run watch` path is removed. `vast deploy` gains
`--frontend` / `--backend` mirroring `release`. `release` keeps `--to staging` only.

## Production: same code, hard-blocked (`src/config/production-lock.ts`)

`export const PRODUCTION_PIPELINE_READY = false;` and `PRODUCTION_NOT_READY_MESSAGE`. Checked
before the lock in `deploy --to production`, `workflow --branch production`, and
`vast production enable`, which all refuse with that message. `promote --to production` (cut the
release PR) keeps working: it is app-repo git and ships nothing. The merge gate
`verifyReleaseMerged` stays. Re-enabling production means flipping the constant and verifying the
prod workflow inputs and folder names with DevOps. No production path is exercised in this change.

## Removed

`deployOne`'s bump-PR hunt, `bumpPrTitle`, `findPullRequest`, `mergePullRequest`,
`waitForWorkflowCompletion`, `getEnvName`, `readDeployedTag` in `helm.ts` (keep `extractTag`), the
`helm` config field, the old per-repo `*-ci-new` workflow names.

## Docs

README (release flow, new `argocd` command, config table, repositories table, troubleshooting),
`skills/release/SKILL.md` (§0 adds `vast argocd status`; §1 and §4 describe the ArgoCD wait and
the new failure modes; production section notes the block), `CLAUDE.md` (invariants: production
pipeline gate; config facts; no Helm reads). Verified against `node bin/vast.js <cmd> --help`.

## Testing

node:test only. deployments reader with an injected fetcher; argocd client against a local `http`
server (login, 401, userinfo); rollout waiter with scripted app states and a fake clock (tag not
yet seen, progressing, healthy, timeout, unauthorized); token store perms and env override under
`VAST_CLI_HOME`; production gate refusals; repos config shape; release/deploy target and option
logic. Live: `vast argocd login`, `vast status --all`, `vast release <one frontend repo>` on
staging end to end, `vast release --frontend --dry-run`. Nothing production.

## Release

2.0.0. The config shape, the deploy contract, and the definition of done all change.
