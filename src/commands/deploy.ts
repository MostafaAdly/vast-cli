/**
 * Deploy Command
 *
 * Dispatches a version to an environment and merges the resulting bump PR.
 *
 * The same GitHub Actions workflow serves both environments — build-ci-new.yaml
 * branches on GITHUB_REF to pick Dockerfile-prod vs Dockerfile-stage and the
 * matching Helm values file — so this is env-agnostic apart from the ref it
 * dispatches on, and the production lock guarding it.
 */

import { Command } from 'commander';
import inquirer from 'inquirer';
import { REPOS, getRepo, isReleasable, type RepoConfig } from '../config/repos.js';
import { isProductionEnabled, PRODUCTION_LOCKED_MESSAGE } from '../config/production-lock.js';
import { nextRc, stripRc } from '../utils/version.js';
import { readDeployedTag } from '../utils/helm.js';
import { aheadBehind } from '../utils/git.js';
import { notify } from '../utils/notify.js';
import {
  runWorkflow,
  waitForWorkflowCompletion,
  findPullRequest,
  mergePullRequest,
  getEnvName,
} from '../utils/github.js';
import { createHeader, createErrorBox, createSpinner, log } from '../utils/ui.js';
import { defaultRepoDir } from './promote.js';

export interface DeployOutcome {
  repo: string;
  version: string;
  status: 'released' | 'skipped' | 'failed';
  detail: string;
}

/**
 * The version to deploy to `env`, given the tag currently on staging.
 *
 * Production ships what has been baking in staging, with the candidate suffix
 * dropped: staging 2.1.0-rc45 -> production 2.1.0.
 */
export function versionFor(env: 'staging' | 'production', stagingTag: string): string {
  return env === 'production' ? stripRc(stagingTag) : nextRc(stagingTag);
}

export async function confirmProduction(repo: string, version: string): Promise<boolean> {
  const { ok } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'ok',
      message: `Deploy ${repo} ${version} to PRODUCTION?`,
      default: false,
    },
  ]);
  return ok;
}

export async function deployOne(
  repo: RepoConfig,
  env: 'staging' | 'production',
  version: string,
  dryRun: boolean,
): Promise<DeployOutcome> {
  if (!repo.workflow) {
    return { repo: repo.name, version, status: 'skipped', detail: 'no deploy workflow exists' };
  }

  log.info(`${repo.name}: deploying ${version} to ${env}`);
  if (dryRun) {
    return { repo: repo.name, version, status: 'skipped', detail: 'dry run' };
  }

  const result = await runWorkflow({
    repository: repo.name,
    version,
    branch: env,
    workflowName: repo.workflow,
  });

  if (!result.success || !result.runId) {
    return {
      repo: repo.name,
      version,
      status: 'failed',
      detail: result.error ?? 'could not identify the dispatched run',
    };
  }

  if (!(await waitForWorkflowCompletion(repo.name, result.runId))) {
    return { repo: repo.name, version, status: 'failed', detail: `run ${result.runId} failed` };
  }

  const prTitle = `chore: bump version to ${version} in ${getEnvName(env)} environment`;
  const spinner = createSpinner(`${repo.name}: looking for the bump PR...`);
  spinner.start();

  let prNumber: number | null = null;
  for (let i = 0; i < 45 && prNumber === null; i++) {
    prNumber = await findPullRequest(repo.name, prTitle);
    if (prNumber === null) await new Promise((r) => setTimeout(r, 20000));
  }

  if (prNumber === null) {
    spinner.fail(`${repo.name}: bump PR never appeared`);
    return { repo: repo.name, version, status: 'failed', detail: 'bump PR not found' };
  }

  try {
    await mergePullRequest(repo.name, prNumber);
    spinner.succeed(`${repo.name}: ${version} deployed to ${env}, PR #${prNumber} merged`);
    return { repo: repo.name, version, status: 'released', detail: `PR #${prNumber}` };
  } catch (error) {
    spinner.fail(`${repo.name}: could not merge PR #${prNumber}`);
    return {
      repo: repo.name,
      version,
      status: 'failed',
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

export function printSummary(outcomes: DeployOutcome[], env: string): void {
  log.newline();
  console.log(createHeader('Summary', ''));
  const width = Math.max(...outcomes.map((o) => o.repo.length), 4);
  for (const o of outcomes) {
    const icon = o.status === 'released' ? '✓' : o.status === 'skipped' ? '–' : '✗';
    console.log(`  ${icon} ${o.repo.padEnd(width)}  ${o.version.padEnd(14)}  ${o.detail}`);
  }

  const released = outcomes.filter((o) => o.status === 'released');
  const failed = outcomes.filter((o) => o.status === 'failed');
  if (released.length || failed.length) {
    notify(
      `**Deploy → ${env}**\n` +
        released.map((o) => `✓ ${o.repo} ${o.version}`).join('\n') +
        (failed.length ? `\n${failed.map((o) => `✗ ${o.repo} — ${o.detail}`).join('\n')}` : ''),
    );
  }
}

interface DeployOptions {
  to: 'staging' | 'production';
  all: boolean;
  dir?: string;
  targetVersion?: string;
  dryRun: boolean;
}

/**
 * Repos `vast deploy` acts on. `--all` is filtered to releasable repos, so an
 * unreleasable repo (no workflow / no Helm) that simply is not cloned yet
 * cannot fail the whole sweep with a spurious "not cloned".
 */
export function deployTargets(repoName: string | undefined, all: boolean): RepoConfig[] {
  return all
    ? REPOS.filter(isReleasable)
    : [getRepo(repoName ?? '')].filter((r): r is RepoConfig => Boolean(r));
}

async function executeDeploy(repoName: string | undefined, options: DeployOptions): Promise<void> {
  if (options.to !== 'staging' && options.to !== 'production') {
    log.error(`Invalid --to value: ${options.to}. Use staging or production.`);
    process.exit(1);
  }

  if (options.to === 'production' && !isProductionEnabled()) {
    console.log(createErrorBox('Production deploys are locked', PRODUCTION_LOCKED_MESSAGE));
    process.exit(1);
  }

  const targets = deployTargets(repoName, options.all);

  if (targets.length === 0) {
    log.error(repoName ? `Unknown repository: ${repoName}` : 'Specify a repository or --all');
    process.exit(1);
  }

  console.log(createHeader('Deploy', `${targets.length} repo(s) | → ${options.to}`));

  const outcomes: DeployOutcome[] = [];
  for (const repo of targets) {
    const dir = options.dir ?? defaultRepoDir(repo);
    if (!dir) {
      outcomes.push({
        repo: repo.name,
        version: '—',
        status: 'failed',
        detail: 'not cloned — run `vast init`, or clone it with `vast clone`',
      });
      continue;
    }
    const stagingHelm = repo.helm.staging;

    let version: string;
    if (options.targetVersion) {
      version = options.targetVersion;
    } else if (!stagingHelm) {
      outcomes.push({
        repo: repo.name,
        version: '—',
        status: 'skipped',
        detail: 'no Helm values — cannot derive a version',
      });
      continue;
    } else {
      try {
        version = versionFor(options.to, readDeployedTag(dir, 'origin/staging', stagingHelm));
      } catch (error) {
        outcomes.push({
          repo: repo.name,
          version: '—',
          status: 'failed',
          detail: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
    }

    // Production only: refuse if the release PR has not been merged yet.
    if (options.to === 'production' && !options.dryRun) {
      const { ahead } = aheadBehind(dir, 'origin/staging', 'origin/production');
      if (ahead > 0) {
        outcomes.push({
          repo: repo.name,
          version,
          status: 'failed',
          detail: `production is missing ${ahead} commit(s) from staging — merge the release PR first`,
        });
        continue;
      }
      if (!(await confirmProduction(repo.name, version))) {
        outcomes.push({ repo: repo.name, version, status: 'skipped', detail: 'declined' });
        continue;
      }
    }

    outcomes.push(await deployOne(repo, options.to, version, options.dryRun));
  }

  printSummary(outcomes, options.to);
  if (outcomes.some((o) => o.status === 'failed')) process.exit(1);
}

export function registerDeployCommand(program: Command): void {
  program
    .command('deploy')
    .description('Dispatch a version to an environment and merge the bump PR')
    .argument('[repository]', 'Repository name (omit and pass --all for every repo)')
    .option('-t, --to <env>', 'Target environment: staging or production', 'staging')
    .option('-a, --all', 'Deploy every configured repo', false)
    .option('--dir <path>', 'Override the local checkout path')
    .option('-v, --target-version <version>', 'Override the derived version')
    .option('-n, --dry-run', 'Report what would happen without deploying', false)
    .addHelpText(
      'after',
      `
Deploys what is already on the branch — it does not promote first.
Use \`vast release\` for promote-then-deploy on staging.

Production is LOCKED by default and requires the release PR to be merged:

  $ vast production enable                      lift the lock
  $ vast promote VastPayPwa --to production     open release/X.Y.Z -> production
  $ # review and merge that PR
  $ vast deploy  VastPayPwa --to production     staging 2.1.0-rc45 -> production 2.1.0
`,
    )
    .action(executeDeploy);
}
