# GitOps Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `vast release` / `vast deploy` drive the new GitOps pipeline (build-deploy workflow → Vast-deployments tag commit → ArgoCD rollout) with live rollout confirmation, production hard-blocked.

**Architecture:** Version source moves from app-repo Helm to Vast-deployments read via `gh api`. Deploy is one path for both envs: dispatch, poll the run, poll ArgoCD until the tag is Synced/Healthy. A new `vast argocd` command manages session tokens. A constant blocks every production deploy path until DevOps migrates production.

**Tech Stack:** TypeScript strict, NodeNext ESM, Commander, inquirer, node:test, Node ≥ 18 global `fetch`, `gh` CLI. No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-09-17-gitops-deploy-design.md`

## Global Constraints

- Relative imports carry `.js`. No new runtime deps. No AI attribution in commits.
- All config I/O under `VAST_CLI_HOME`; tests set it before importing the module under test.
- Docs (README, skills/release/SKILL.md, CLAUDE.md) ship in the same PR and are verified against `node bin/vast.js <cmd> --help`.
- `PRODUCTION_PIPELINE_READY = false`. No production path is exercised live. No ArgoCD production call is made in tests or manually.
- Tasks 1–5 run in parallel on disjoint files. Each runs only its own test files, never the full suite or the build, and does not commit. Task 6 integrates.

---

### Task 1: Repo config shape (`src/config/repos.ts`, `tests/repos.test.ts`)

**Produces:**
```ts
export type DeployEnv = 'staging' | 'production';
export const DEPLOY_ENVS: DeployEnv[] = ['staging', 'production'];
export interface RepoConfig {
  name: string;
  workflow: { staging: string | null; production: string | null };
  deployments: { staging: string | null; production: string | null };
  promoteFrom: { staging: string | null; production: string | null };
  teams: string[];
  releaseTeam: ReleaseTeam | null;
}
export function deploymentsFile(repo: RepoConfig, env: DeployEnv): string | null; // repo.deployments[env]
export function argoApp(repo: RepoConfig, env: DeployEnv): string | null; // basename(dirname(file)), e.g. 'vastpay-dasaboard'
export function isReleasable(repo: RepoConfig): boolean; // Boolean(workflow.staging && deployments.staging)
```
Values: all nine releasable repos get `workflow: { staging: 'build-deploy', production: 'build-deploy' }`; staging file `deployments/helm/staging/<folder>/stage.yaml` with the folder map from the spec (VastPay-DashBoard → `vastpay-dasaboard`, sic); production file `deployments/helm/production/<RepoName>/prod.yaml`. Unreleasable repos: all nulls. Remove `helm`. Update the header comment (facts read from GitHub on 2026-09-17).

Tests (replace the Helm assertions): the exact nine staging folder names; `argoApp(VastPay-DashBoard,'staging') === 'vastpay-dasaboard'`; `argoApp(Terraform,'staging') === null`; production file uses the repo name; `isReleasable` still nine; every train member releasable.

### Task 2: Deployed-tag reader (`src/utils/deployments.ts`, `tests/deployments.test.ts`, trim `src/utils/helm.ts`)

**Produces:**
```ts
export const DEPLOYMENTS_REPO = 'Vast-deployments';
export type FetchFile = (path: string) => Promise<string>; // file contents at main
export function fetchDeploymentsFile(path: string): Promise<string>; // gh api repos/<ORG>/Vast-deployments/contents/<path>?ref=main --jq .content, base64-decoded; throws `no <path> in Vast-deployments` on 404
export function deployedTag(repo: RepoConfig, env: DeployEnv, fetchFile?: FetchFile): Promise<string>; // throws `<repo> has no <env> deployments file` when null
export function deploymentsFileUrl(path: string): string; // https://github.com/<ORG>/Vast-deployments/blob/main/<path>
```
`helm.ts` keeps only `extractTag`; delete its git-based `readDeployedTag`. `tests/helm.test.ts` stays. ORG comes from `src/utils/remote.ts`.

Tests with an injected fetcher: returns the first tag from a real-shaped stage.yaml (copy the sample from the spec's file layout: `deployment: containers: - image: tag: "2.1.3-rc20"`); null env file throws with the repo name; fetcher rejecting propagates its message.

### Task 3: ArgoCD (`src/config/argocd.ts`, `src/utils/argocd.ts`, `src/commands/argocd.ts`, `tests/argocd-config.test.ts`, `tests/argocd.test.ts`)

**Produces:**
```ts
// src/config/argocd.ts
export const DEFAULT_ARGOCD_HOSTS = { staging: 'https://argocd-stg.vastmenu.com', production: 'https://argocd-prod.vastmenu.com' };
export function argocdFile(env: DeployEnv): string;               // <vastHome>/argocd/<env>.json
export function argocdHost(env: DeployEnv): string;               // file.host ?? default
export function readArgocdToken(env: DeployEnv): string | null;   // process.env.VAST_ARGOCD_TOKEN_<ENV> ?? file.token ?? null
export function saveArgocdToken(env: DeployEnv, token: string, username: string): void; // mode 0o600, { host?, token, username, savedAt }
export function forgetArgocdToken(env: DeployEnv): void;
export function argocdAppUrl(env: DeployEnv, app: string): string; // `${host}/applications/${app}`

// src/utils/argocd.ts
export class ArgoUnauthorizedError extends Error {}
export interface ArgoApp { syncStatus: string; healthStatus: string; images: string[]; revision: string }
export function login(host: string, username: string, password: string, fetchFn?: typeof fetch): Promise<string>; // POST /api/v1/session → token
export function userinfo(host: string, token: string, fetchFn?: typeof fetch): Promise<{ loggedIn: boolean; username?: string }>;
export function getApplication(host: string, token: string, app: string, fetchFn?: typeof fetch): Promise<ArgoApp>; // 401/403 → ArgoUnauthorizedError
export interface RolloutDeps { getApp: () => Promise<ArgoApp>; sleep: (ms: number) => Promise<void>; now: () => number; print: (line: string) => void }
export interface RolloutTiming { pollMs: number; heartbeatMs: number; timeoutMs: number; maxConsecutiveErrors: number }
export const DEFAULT_ROLLOUT_TIMING: RolloutTiming = { pollMs: 5000, heartbeatMs: 30000, timeoutMs: 600000, maxConsecutiveErrors: 12 };
export interface RolloutResult { ok: boolean; elapsedMs: number; reason?: string; app?: ArgoApp }
export function rolloutDone(app: ArgoApp, tag: string): boolean; // images.some(i => i.endsWith(':' + tag)) && healthStatus==='Healthy' && syncStatus==='Synced'
export function waitForRollout(label: string, appName: string, tag: string, deps: RolloutDeps, timing?: RolloutTiming): Promise<RolloutResult>;
```
Line shape: `  ${label}  argocd ${appName}  ${state}  ${formatElapsed(elapsed)}` where state is `waiting for <tag>` until an image carries the tag, then `<sync>/<health>` (e.g. `OutOfSync/Progressing`). Print on state change and on heartbeat, like `pollRun`. Timeout → `{ ok: false, reason: 'timed out after 10m00s' }`. `ArgoUnauthorizedError` → `{ ok: false, reason: 'argocd unauthorized — run `vast argocd login`' }` immediately. Other errors count consecutively; give up at 12 with the message.

Command `vast argocd`: `login [--to <env>] [--username <u>]` (inquirer input + password, calls `login`, `saveArgocdToken`, prints "logged in to <host> as <u>"); `status` (per env: host, token present?, and if present whether `userinfo` says loggedIn; never prints the token); `logout [--to <env>]`. Register in `src/cli.ts` after `production`. Help text explains that release/deploy wait for ArgoCD and need this once per session lifetime.

Tests: config under a temp `VAST_CLI_HOME` (env var beats file; file mode 0600; forget removes; host override). Client against a local `node:http` server: login returns the token from `{token}`; 401 on session → error with server message; getApplication maps fields and throws `ArgoUnauthorizedError` on 401. Waiter with scripted apps and fake clock: waits for tag then healthy; prints `waiting for` line once then state changes; heartbeat; timeout; unauthorized short-circuits; error streak resets on a good read.

### Task 4: Wire deploy, release, status, promote, production (owner of `src/commands/deploy.ts`, `release.ts`, `status.ts`, `promote.ts`, `production.ts`, `workflow.ts`, `src/config/production-lock.ts`, `src/utils/github.ts`, `tests/deploy.test.ts`, `tests/release.test.ts`, `tests/production-lock.test.ts`, `tests/deploy-gate.test.ts` if needed)

**Consumes:** everything Tasks 1–3 produce (code against the signatures above; they land concurrently).

**Produces / changes:**
```ts
// production-lock.ts
export const PRODUCTION_PIPELINE_READY = false;
export const PRODUCTION_NOT_READY_MESSAGE: string; // "Production has not moved to the new deploy pipeline yet ... promote --to production still works ..."
export function productionPipelineReady(): boolean;

// deploy.ts
export interface DeployOutcome { repo; version; status: 'released'|'skipped'|'failed'; detail }
export interface DeploySlot { board: StatusBoard; row: number; labelWidth: number }
export async function deployOne(repo: RepoConfig, env: DeployEnv, version: string, dryRun: boolean, slot: DeploySlot, timing: PollTiming, deps?: DeployDeps): Promise<DeployOutcome>;
export interface DeployDeps { runWorkflow; getRunStatus; failedStepName: (repo: string, runId: number) => Promise<string | null>; waitForRollout; getApplication; readArgocdToken; argocdHost }
export function deployTargets(names: string[], sweep: Sweep): { repos: RepoConfig[]; unknown: string[] } // same semantics as releaseTargets; move Sweep/isSweep into deploy.ts and re-export from release.ts
```
`deployOne` flow per spec §Deploy. If no ArgoCD token for the env: fail BEFORE dispatching with `no ArgoCD token for <env> — run \`vast argocd login\``, so a build is never started that cannot be confirmed. `failedStepName` uses `gh run view <id> --json jobs`. The `github.ts` exports `findPullRequest`, `mergePullRequest`, `waitForWorkflowCompletion`, `getEnvName` are deleted (check `workflow.ts` first; keep what it uses). `runWorkflow` unchanged.

`release.ts`: `prepareOne` becomes async, derives via `deployedTag(repo, 'staging')`; `launchOne`/`finishOne` collapse into calling `deployOne` after promote, on the shared board; single repo uses the same board path (rows = 1). Remove the bump-PR code. Keep every option/target test green.

`deploy.ts` command: `--frontend`/`--backend`/`--all`, multiple names, same validation as release. Order of production checks: `productionPipelineReady()` → lock → merge gate → confirm.

`status.ts`: staging/production columns from `deployedTag` (concurrent per repo, `?` on error, `n/a` when null); drift unchanged.

`promote.ts`: production version = `stripRc(await deployedTag(repo,'staging'))`; hotfix version = `nextPatch(await deployedTag(repo,'production'))`; `promote()` becomes async; `release.ts` awaits it. Fixture-repo tests for promote must stay green.

`production.ts`: `enable` refuses first with `PRODUCTION_NOT_READY_MESSAGE` (exit 1); `status` shows `Pipeline: not migrated — deploys blocked` line. `workflow.ts`: `--branch production` refuses the same way before the lock.

Tests: `productionPipelineReady()` false and `enable` path refuses (call the exported handler or test the guard function); `deployOne` with fully injected deps: dry run → skipped; missing token → failed without calling runWorkflow; run failed at `update-helm` step → detail mentions "committing the tag"; run ok + rollout ok → released with app URL; rollout timed out → failed. `deployTargets` mirrors releaseTargets tests. Remove `bumpPrTitle` test.

### Task 5: Docs (`README.md`, `skills/release/SKILL.md`, `CLAUDE.md`)

Per spec §Docs. Write against the spec's command shapes; Task 6 re-verifies against `--help` and fixes drift. Update the Repositories table (Releasable column now means workflow + deployments file), Configuration table (`argocd/<env>.json`), the flow text (no bump PRs; ArgoCD wait; ~3 min), troubleshooting rows (`no ArgoCD token`, `argocd unauthorized`, `timed out` after 10 minutes, `failed committing the tag`), production block. CLAUDE.md: replace Helm facts; add invariant "production is hard-blocked by `PRODUCTION_PIPELINE_READY` until DevOps migrates it; do not flip without verifying the prod workflow inputs and folder names"; note VastPayPwa's `5.0.1` seed tag.

### Task 6: Integrate (main session)

`npm test`, `npm run typecheck`, `npm run build`, every `--help` vs docs, `npm run bundle`; `vast argocd login` (user-driven), `vast status --all`, `vast release --frontend --dry-run`, one real `vast release <small frontend repo>`; code review; commit; PR; 2.0.0.
