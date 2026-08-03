/**
 * Promote Command
 *
 * The merge half of the release chain: fast-forward both branches, verify the
 * merge is clean without touching the working tree, then merge and push.
 *
 * Refuses on conflict. It never attempts a resolution — a stranded half-merged
 * checkout is the exact failure this replaces.
 *
 * Production is different in kind: it opens a reviewed release/X.Y.Z pull
 * request and stops. Nothing here merges it, and it is gated on the production
 * lock being lifted.
 */

import { Command } from 'commander';
import { existsSync } from 'fs';
import { join } from 'path';
import { getRepo, type RepoConfig } from '../config/repos.js';
import { isProductionEnabled, PRODUCTION_LOCKED_MESSAGE } from '../config/production-lock.js';
import { isClean, fetch as gitFetch, aheadBehind, trialMerge, mergeAndPush } from '../utils/git.js';
import { readDeployedTag } from '../utils/helm.js';
import { stripRc } from '../utils/version.js';
import { cutReleaseBranch } from '../utils/release-branch.js';
import { createHeader, createErrorBox, log } from '../utils/ui.js';
import { WORKSPACE } from './status.js';

export function defaultRepoDir(repo: RepoConfig): string {
  return join(WORKSPACE, repo.localDir);
}

/** @returns true when the promotion completed (or would have, under dryRun). */
export function promote(
  repo: RepoConfig,
  dir: string,
  to: 'staging' | 'production',
  dryRun: boolean,
): boolean {
  if (to === 'production' && !isProductionEnabled()) {
    console.log(createErrorBox(`Cannot promote ${repo.name} to production`, PRODUCTION_LOCKED_MESSAGE));
    return false;
  }

  if (!existsSync(join(dir, '.git'))) {
    console.log(createErrorBox(`${repo.name} is not cloned`, `Expected a checkout at ${dir}`));
    return false;
  }

  if (!isClean(dir)) {
    console.log(
      createErrorBox(`${repo.name} has uncommitted changes`, 'Commit or stash them before promoting.'),
    );
    return false;
  }

  gitFetch(dir);

  if (to === 'production') {
    const helm = repo.helm.staging;
    if (!helm) {
      console.log(
        createErrorBox(`${repo.name}: no staging Helm values`, 'Cannot derive a release version.'),
      );
      return false;
    }
    const { ahead } = aheadBehind(dir, 'origin/staging', 'origin/production');
    if (ahead === 0) {
      log.info(`${repo.name}: production already contains staging. Nothing to release.`);
      return true;
    }
    const version = stripRc(readDeployedTag(dir, 'origin/staging', helm));
    log.info(`${repo.name}: ${ahead} commit(s) staging → production, release ${version}`);
    return cutReleaseBranch(dir, repo.name, version, dryRun) !== null || dryRun;
  }

  const from = repo.promoteFrom.staging;
  if (!from) {
    console.log(
      createErrorBox(
        `Cannot promote ${repo.name} into staging`,
        `No promotion source is configured. ${repo.name} has no usable \`develop\` — ` +
          `human PRs there target \`staging\` directly, so merging \`develop\` would ` +
          `regress it by hundreds of commits.`,
      ),
    );
    return false;
  }

  const { ahead } = aheadBehind(dir, `origin/${from}`, 'origin/staging');
  if (ahead === 0) {
    log.info(`${repo.name}: staging already contains ${from}. Nothing to promote.`);
    return true;
  }

  const trial = trialMerge(dir, 'origin/staging', `origin/${from}`);
  if (!trial.clean) {
    console.log(
      createErrorBox(
        `${repo.name}: ${from} → staging conflicts`,
        `${trial.conflicts.length} conflicting file(s):\n` +
          trial.conflicts.map((f) => `  • ${f}`).join('\n') +
          `\n\nNothing was changed. Resolve these before promoting.`,
      ),
    );
    return false;
  }

  log.info(`${repo.name}: ${ahead} commit(s) from ${from} → staging, merge is clean`);

  if (dryRun) {
    log.muted('  (dry run — no merge performed)');
    return true;
  }

  mergeAndPush(dir, 'staging', `origin/${from}`);
  log.success(`${repo.name}: ${from} → staging pushed`);
  return true;
}

async function executePromote(
  repoName: string,
  options: { to: 'staging' | 'production'; dir?: string; dryRun: boolean },
): Promise<void> {
  const repo = getRepo(repoName);
  if (!repo) {
    log.error(`Unknown repository: ${repoName}`);
    process.exit(1);
  }

  if (options.to !== 'staging' && options.to !== 'production') {
    log.error(`Invalid --to value: ${options.to}. Use staging or production.`);
    process.exit(1);
  }

  console.log(createHeader('Promote', `${repo.name} | → ${options.to}`));
  if (!promote(repo, options.dir ?? defaultRepoDir(repo), options.to, options.dryRun)) {
    process.exit(1);
  }
}

export function registerPromoteCommand(program: Command): void {
  program
    .command('promote')
    .description('Merge develop into staging, or open a release PR into production')
    .argument('<repository>', 'Repository name')
    .option('-t, --to <env>', 'Target environment: staging or production', 'staging')
    .option('--dir <path>', 'Override the local checkout path')
    .option('-n, --dry-run', 'Report what would happen without merging', false)
    .addHelpText(
      'after',
      `
Examples:
  $ vast promote VastPayPwa                      develop -> staging, push
  $ vast promote VastPayPwa --dry-run            check for conflicts, change nothing
  $ vast promote VastPayPwa --to production      open release/X.Y.Z -> production PR

Production requires the lock to be lifted first (vast production enable), and
the release PR is opened for review — never merged by this tool.
`,
    )
    .action(executePromote);
}
