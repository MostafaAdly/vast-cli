/**
 * Release Command
 *
 * The whole staging ritual in one line: promote develop → staging, derive the
 * next release candidate from the deployed Helm tag, dispatch the workflow,
 * wait for it, and merge the version-bump PR.
 *
 * Staging only. Production has a human review gate in the middle, so it is two
 * commands (promote, then deploy) rather than one.
 */

import { Command } from 'commander';
import { REPOS, getRepo, isReleasable, type RepoConfig } from '../config/repos.js';
import { nextRc, bump as bumpVersion } from '../utils/version.js';
import { readDeployedTag } from '../utils/helm.js';
import { promote } from './promote.js';
import { repoDir } from '../config/workspace.js';
import { deployOne, notClonedOutcome, printSummary, type DeployOutcome } from './deploy.js';
import { createHeader, createErrorBox, log } from '../utils/ui.js';

interface ReleaseOptions {
  to: string;
  dir?: string;
  dryRun: boolean;
  targetVersion?: string;
  /** Start a new version series instead of continuing the current rc run. */
  bump?: 'patch' | 'minor' | 'major';
  skipPromote: boolean;
  all: boolean;
}

async function releaseOne(repo: RepoConfig, options: ReleaseOptions): Promise<DeployOutcome> {
  const dir = repoDir(repo, options.dir);
  if (!dir) return notClonedOutcome(repo.name, options.all);

  if (!repo.workflow) {
    return { repo: repo.name, version: '—', status: 'skipped', detail: 'no deploy workflow exists' };
  }
  const helmPath = repo.helm.staging;
  if (!helmPath) {
    return { repo: repo.name, version: '—', status: 'skipped', detail: 'no staging Helm values' };
  }

  if (!options.skipPromote) {
    if (!promote(repo, dir, 'staging', options.dryRun)) {
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
      const deployed = readDeployedTag(dir, 'origin/staging', helmPath);
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

  return deployOne(repo, 'staging', version, options.dryRun);
}

/**
 * Repos `vast release` acts on. `--all` is filtered to releasable repos, so an
 * unreleasable repo (no workflow / no Helm) that simply is not cloned yet
 * cannot fail the whole sweep with a spurious "not cloned".
 */
export function releaseTargets(repoName: string | undefined, all: boolean): RepoConfig[] {
  return all
    ? REPOS.filter(isReleasable)
    : [getRepo(repoName ?? '')].filter((r): r is RepoConfig => Boolean(r));
}

async function executeRelease(
  repoName: string | undefined,
  options: ReleaseOptions,
): Promise<void> {
  if (options.bump && options.targetVersion) {
    log.error('--bump and --target-version are mutually exclusive.');
    process.exit(1);
  }
  if (options.bump && !['patch', 'minor', 'major'].includes(options.bump)) {
    log.error(`Invalid --bump level: ${options.bump}. Use patch, minor, or major.`);
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
          'Add `--as hotfix` to the promote for a hotfix/X.Y.Z branch instead.\n' +
          'The promote works any time; only the deploy needs `vast production enable`.',
      ),
    );
    process.exit(1);
  }

  const targets = releaseTargets(repoName, options.all);

  if (targets.length === 0) {
    log.error(repoName ? `Unknown repository: ${repoName}` : 'Specify a repository or --all');
    process.exit(1);
  }

  console.log(createHeader('Release', `${targets.length} repo(s) | → staging`));

  // Sequential: each release watches a CI run and merges a PR. Running these
  // concurrently would interleave `gh run watch` output into an unreadable mess.
  const outcomes: DeployOutcome[] = [];
  for (const repo of targets) {
    outcomes.push(await releaseOne(repo, options));
  }

  printSummary(outcomes, 'staging');
  if (outcomes.some((o) => o.status === 'failed')) process.exit(1);
}

export function registerReleaseCommand(program: Command): void {
  program
    .command('release')
    .description('Promote develop to staging, derive the version, deploy, merge the bump PR')
    .argument('[repository]', 'Repository name (omit and pass --all for every repo)')
    .option('-t, --to <env>', 'Target environment (staging only)', 'staging')
    .option('-a, --all', 'Release every configured repo', false)
    .option('--dir <path>', 'Override the local checkout path')
    .option('-v, --target-version <version>', 'Override the derived version entirely')
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
  $ vast release --all                       every configured repo, one summary
`,
    )
    .action(executeRelease);
}
