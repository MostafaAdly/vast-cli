/**
 * Release Command
 *
 * The whole staging ritual in one line: promote develop → staging, derive the
 * next release candidate from the tag Vast-deployments says is live, dispatch
 * the repo's "<Repo> Pipeline" workflow (build-deploy.yml), watch the run, and
 * watch ArgoCD until the new tag is actually running. There is no version-bump PR any more — staging is GitOps.
 *
 * Several repos at once behave like one terminal per repo: each is promoted in
 * turn — seconds of local git — and then every deploy runs concurrently, so the
 * whole thing takes about one build rather than one per repo. One repo refusing
 * never stops another.
 *
 * Staging only. Production has a human review gate in the middle, so it is two
 * commands (promote, then deploy) rather than one — and its deploy is blocked
 * outright until DevOps has migrated it.
 */

import { Command } from 'commander';
import { reposForRelease, type ReleaseTeam, type RepoConfig } from '../config/repos.js';
import { nextRc, bump as bumpVersion } from '../utils/version.js';
import { deployedTag } from '../utils/deployments.js';
import { promote } from './promote.js';
import { repoDir } from '../config/workspace.js';
import {
  deployMany,
  isSweep,
  notClonedOutcome,
  perRepoOptionProblem,
  pollIntervalFor,
  pollTimingFor,
  printSummary,
  sweepAndNamesProblem,
  sweepTargets,
  type Deployable,
  type DeployManyDeps,
  type DeployOutcome,
  type Sweep,
} from './deploy.js';
import { createHeader, createErrorBox, log } from '../utils/ui.js';

// `release` and `deploy` must agree on what a sweep flag means and on how fast
// runs are polled, so both live in deploy.ts and are re-exported here rather
// than written twice.
export { isSweep, pollIntervalFor, pollTimingFor, type Deployable, type Sweep };

export interface ReleaseOptions {
  to: string;
  dir?: string;
  dryRun: boolean;
  targetVersion?: string;
  /** Start a new version series instead of continuing the current rc run. */
  bump?: 'patch' | 'minor' | 'major';
  skipPromote: boolean;
  all: boolean;
  frontend: boolean;
  backend: boolean;
}

const BUMP_LEVELS = ['patch', 'minor', 'major'];

/**
 * Whether this repo has a develop branch to promote into staging.
 *
 * `vast promote <repo>` (explicit) still refuses when this is false — an
 * explicit ask to merge develop deserves an explanation, not a silent no-op.
 * Only `vast release` treats it as a skip.
 */
export function needsPromotion(repo: RepoConfig): boolean {
  return repo.promoteFrom.staging !== null;
}

/**
 * Option combinations that cannot mean anything, refused before any repo is
 * touched — never after the first repo has already been released.
 */
export function validateReleaseOptions(
  names: string[],
  options: Sweep & { targetVersion?: string; dir?: string; bump?: string },
): string | null {
  const both = sweepAndNamesProblem(names, options);
  if (both) return both;
  if (options.bump && options.targetVersion) return '--bump and --target-version are mutually exclusive.';
  if (options.bump && !BUMP_LEVELS.includes(options.bump)) {
    return `Invalid --bump level: ${options.bump}. Use patch, minor, or major.`;
  }
  return perRepoOptionProblem(names, options);
}

/**
 * Repos `vast release` acts on, in the order they were named, deduplicated.
 *
 * A sweep releases whole trains, declared per repo in the config rather than
 * derived here: a repo outside both trains (vast-menu-payments) and an
 * unreleasable one (Terraform, Vast-Finance, vastpay-payment-odoo) are simply
 * never swept, so a sweep can never fail on a repo the user was not asking
 * about. `--all` is the frontend train then the backend one; naming the trains
 * individually keeps that same order. Named repos are never filtered: an
 * explicit `vast release Terraform` deserves "no deploy workflow", not
 * "unknown repository".
 */
export function releaseTargets(
  names: string[],
  sweep: Sweep,
): { repos: RepoConfig[]; unknown: string[] } {
  return sweepTargets(names, sweep);
}

/**
 * Everything before the deploy: resolve the checkout, promote, derive the
 * version. Returns an outcome instead when the repo cannot go further.
 *
 * Async because the deployed tag now comes from Vast-deployments over the API,
 * not from a file in the local checkout.
 */
export async function prepareOne(
  repo: RepoConfig,
  options: ReleaseOptions,
): Promise<Deployable | DeployOutcome> {
  const dir = repoDir(repo, options.dir);
  // Any sweep, not just --all: a repo the user did not name is skipped when it
  // is not on this machine, and failed only when they asked for it by name.
  // A release still needs the checkout — it promotes with local git.
  if (!dir) return notClonedOutcome(repo.name, isSweep(options));

  if (!repo.workflow.staging) {
    return { repo: repo.name, version: '—', status: 'skipped', detail: 'no deploy workflow exists' };
  }
  if (!repo.deployments.staging) {
    return {
      repo: repo.name,
      version: '—',
      status: 'skipped',
      detail: 'no staging deployments file — nothing watches this repo',
    };
  }

  if (!options.skipPromote) {
    if (!needsPromotion(repo)) {
      // The backend repos have no usable develop — human PRs there target
      // staging directly. Failing the release for a promotion that cannot
      // exist made the everyday command unusable for that team and turned
      // every `release --all` sweep red. Skipping is not a policy change:
      // there is nothing to promote.
      log.muted(`  ${repo.name}: no develop to promote — deploying what is on staging`);
    } else if (!(await promote(repo, dir, 'staging', options.dryRun))) {
      return { repo: repo.name, version: '—', status: 'failed', detail: 'promotion refused' };
    }
  }

  let version: string;
  if (options.targetVersion) {
    version = options.targetVersion;
  } else {
    try {
      // Derived from what is DEPLOYED, not from the highest version ever cut.
      // Default continues the current rc series; --bump starts a new one at rc1.
      const deployed = await deployedTag(repo, 'staging');
      version = options.bump ? bumpVersion(deployed, options.bump) : nextRc(deployed);
    } catch (error) {
      return {
        repo: repo.name,
        version: '—',
        status: 'failed',
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return { repo, version };
}

/** The two halves of a release, injectable so they can be faked in tests. */
export interface ReleaseManyDeps extends DeployManyDeps {
  prepare?: (repo: RepoConfig, options: ReleaseOptions) => Promise<Deployable | DeployOutcome>;
}

/**
 * Every repo, like one terminal per repo. Promote and derive each in turn
 * (seconds of local git), then deploy them all concurrently on one shared
 * board (minutes of CI and ArgoCD).
 *
 * One repo takes the same path with a single-row board: a second code path for
 * the common case is a second place for the ArgoCD wait to be forgotten.
 */
export async function releaseMany(
  targets: RepoConfig[],
  options: ReleaseOptions,
  deps: ReleaseManyDeps = {},
): Promise<DeployOutcome[]> {
  const prepare = deps.prepare ?? prepareOne;
  const planned: Array<Deployable | DeployOutcome> = [];
  for (const repo of targets) planned.push(await prepare(repo, options));
  return deployMany(planned, 'staging', options.dryRun, deps);
}

async function executeRelease(repoNames: string[], options: ReleaseOptions): Promise<void> {
  const problem = validateReleaseOptions(repoNames, options);
  if (problem) {
    log.error(problem);
    process.exit(1);
  }

  if (options.to !== 'staging') {
    console.log(
      createErrorBox(
        `\`release\` only targets staging`,
        'Production has a human review gate in the middle, so it is two steps:\n\n' +
          '    vast promote <repo> --to production    cut release/X.Y.Z + PR\n' +
          '    # review and merge that PR\n' +
          '    vast deploy  <repo> --to production    build and ship it\n\n' +
          'Add `--as hotfix` to the promote for a hotfix/X.Y.Z branch instead.\n\n' +
          'The promote works any time. The production DEPLOY is currently blocked\n' +
          'outright: production has not moved to the new pipeline yet, so it is\n' +
          'shipped by hand until DevOps has migrated it.',
      ),
    );
    process.exit(1);
  }

  const { repos: targets, unknown } = releaseTargets(repoNames, options);
  if (unknown.length > 0) {
    log.error(`Unknown ${unknown.length === 1 ? 'repository' : 'repositories'}: ${unknown.join(', ')}`);
    process.exit(1);
  }
  if (targets.length === 0) {
    log.error('Specify a repository, or --all / --frontend / --backend');
    process.exit(1);
  }

  console.log(createHeader('Release', `${targets.length} repo(s) | → staging`));

  const outcomes = await releaseMany(targets, options);

  printSummary(outcomes, 'staging');
  if (outcomes.some((o) => o.status === 'failed')) process.exit(1);
}

/** The train members, listed from the config so the help can never drift from it. */
function trainNames(team: ReleaseTeam): string {
  return reposForRelease(team)
    .map((r) => r.name)
    .join(', ');
}

export function registerReleaseCommand(program: Command): void {
  program
    .command('release')
    .description('Promote develop to staging, derive the version, deploy, wait for ArgoCD')
    .argument('[repositories...]', 'Repository name(s) (omit and pass --all, --frontend or --backend)')
    .option('-t, --to <env>', 'Target environment (staging only)', 'staging')
    .option('-a, --all', 'Release the frontend and backend repos', false)
    .option('--frontend', 'Release the frontend repos', false)
    .option('--backend', 'Release the backend repos', false)
    .option('--dir <path>', 'Override the local checkout path (one repo only)')
    .option('-v, --target-version <version>', 'Override the derived version entirely (one repo only)')
    .option('--bump <level>', 'Start a new series: patch, minor, or major')
    .option('--skip-promote', 'Deploy what is already on the branch', false)
    .option('-n, --dry-run', 'Report what would happen without merging or deploying', false)
    .addHelpText(
      'after',
      `
Version derivation (from the tag currently deployed to staging):

  $ vast release VastPayPwa                  1.5.5-rc15 -> 1.5.5-rc16   continue the series
  $ vast release VastPayPwa --bump patch     1.5.5-rc15 -> 1.5.6-rc1    new patch series
  $ vast release VastPayPwa --bump minor     1.5.5-rc15 -> 1.6.0-rc1    new minor series
  $ vast release VastPayPwa --bump major     1.5.5-rc15 -> 2.0.0-rc1    new major series

  $ vast release VastPayPwa --dry-run        show the derived version, deploy nothing
  $ vast release VastPayPwa VastMenuPwa      both at once, one summary
  $ vast release --frontend                  the frontend repos, side by side
  $ vast release --backend                   the backend repos
  $ vast release --all                       frontend and backend, one summary

What a release does (there is no version-bump PR any more — staging is GitOps):

  1. promote develop into staging
  2. dispatch the repo's "<Repo> Pipeline" workflow (build-deploy.yml),
     which builds the image and commits the tag into Vast-deployments
  3. watch the run
  4. ask ArgoCD to refresh the app, then watch it until that tag is
     Synced/Healthy

Step 4 needs an ArgoCD session token, so log in once per token lifetime:

  $ vast argocd login              store a staging token
  $ vast argocd status             is it still valid?

Without a token the deploy still runs, but the CLI cannot confirm the rollout
and says so in the summary. Log in with \`vast argocd login\` to get live
confirmation.

Several repos release side by side, as if each had its own terminal: each is
promoted in turn, then every deploy runs at the same time, each on its own line
that updates in place (one line per change when output is piped). One repo
refusing never stops another.

Release trains (--all is both):
  --frontend   ${trainNames('frontend')}
  --backend    ${trainNames('backend')}
vast-menu-payments is in neither train — release it by name.

--bump, --skip-promote and --dry-run apply to every repo named; --target-version
and --dir are per-repo and refused with a sweep flag or more than one repo.
`,
    )
    .action(executeRelease);
}
