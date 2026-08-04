/**
 * Status Command
 *
 * Read-only. Reports, per repo, what is deployed to staging and production and
 * how far apart the long-lived branches have drifted — replacing the
 * checkout-pull-look loop.
 */

import { Command } from 'commander';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { REPOS, getRepo, type RepoConfig } from '../config/repos.js';
import { readDeployedTag } from '../utils/helm.js';
import { fetchBranches, aheadBehind } from '../utils/git.js';
import { createHeader, createSpinner, log } from '../utils/ui.js';

export const WORKSPACE = join(homedir(), 'Workshop', 'Work', 'vastgroup');

export function repoDir(repo: RepoConfig, override?: string): string {
  return override ?? join(WORKSPACE, repo.localDir);
}

interface Row {
  name: string;
  staging: string;
  production: string;
  drift: string;
}

/** The remote-tracking branches this repo's row is built from. */
function branchesRead(repo: RepoConfig): string[] {
  const branches = ['staging', 'production'];
  if (repo.promoteFrom.staging) branches.push(repo.promoteFrom.staging);
  return branches;
}

/**
 * Refresh every repo at once.
 *
 * Fetching is network-bound and was the whole cost of this command: ~0.9s per
 * repo, run one after another, was ~9s of a ~10s run. Concurrently it costs
 * roughly one repo's latency. Failures are reported per repo rather than
 * failing the sweep.
 *
 * @returns names of repos whose fetch failed.
 */
async function refreshAll(targets: RepoConfig[], dirOverride?: string): Promise<Set<string>> {
  const failed = new Set<string>();
  await Promise.all(
    targets.map(async (repo) => {
      const dir = repoDir(repo, dirOverride);
      if (!existsSync(join(dir, '.git'))) return;
      try {
        // Only a total failure counts. A repo missing one of these branches is
        // a fact about the repo, and the row reports it as "n/a" or "?".
        if (!(await fetchBranches(dir, branchesRead(repo)))) failed.add(repo.name);
      } catch {
        failed.add(repo.name);
      }
    }),
  );
  return failed;
}

function inspect(repo: RepoConfig, dir: string, fetchFailed: boolean): Row {
  if (!existsSync(join(dir, '.git'))) {
    return { name: repo.name, staging: '—', production: '—', drift: 'not cloned' };
  }

  if (fetchFailed) {
    return { name: repo.name, staging: '?', production: '?', drift: 'fetch failed' };
  }

  const tag = (env: 'staging' | 'production'): string => {
    const path = repo.helm[env];
    if (!path) return 'n/a';
    try {
      return readDeployedTag(dir, `origin/${env}`, path);
    } catch {
      return '?';
    }
  };

  let drift: string;
  const source = repo.promoteFrom.staging;
  if (!source) {
    drift = 'no develop';
  } else {
    try {
      const { ahead } = aheadBehind(dir, `origin/${source}`, 'origin/staging');
      drift = ahead === 0 ? 'in sync' : `${source} +${ahead}`;
    } catch {
      drift = '?';
    }
  }

  return { name: repo.name, staging: tag('staging'), production: tag('production'), drift };
}

async function executeStatus(
  repoName: string | undefined,
  options: { all: boolean; dir?: string; fetch: boolean },
): Promise<void> {
  const targets = repoName
    ? [getRepo(repoName)].filter((r): r is RepoConfig => Boolean(r))
    : options.all
      ? REPOS
      : [];

  if (targets.length === 0) {
    log.error(repoName ? `Unknown repository: ${repoName}` : 'Specify a repository or --all');
    process.exit(1);
  }

  let fetchFailed = new Set<string>();
  if (options.fetch) {
    // Only animate on a terminal — piped output would keep the spinner's text
    // as a stray line.
    const spinner = process.stdout.isTTY
      ? createSpinner(`Refreshing ${targets.length} repo(s)...`).start()
      : null;
    fetchFailed = await refreshAll(targets, options.dir);
    spinner?.stop();
  }

  console.log(createHeader('Release Status', options.fetch ? 'Vast Group' : 'Vast Group (local refs)'));

  const rows = targets.map((r) => inspect(r, repoDir(r, options.dir), fetchFailed.has(r.name)));

  // Widths come from the data, not constants — real tags run long
  // ("1.1.3-rc4-health") and a fixed width silently breaks the columns.
  const col = (header: string, pick: (r: Row) => string): number =>
    Math.max(header.length, ...rows.map((r) => pick(r).length));
  const wName = col('REPO', (r) => r.name);
  const wStage = col('STAGING', (r) => r.staging);
  const wProd = col('PRODUCTION', (r) => r.production);

  console.log(
    `  ${'REPO'.padEnd(wName)}  ${'STAGING'.padEnd(wStage)}  ${'PRODUCTION'.padEnd(wProd)}  DRIFT`,
  );
  for (const r of rows) {
    console.log(
      `  ${r.name.padEnd(wName)}  ${r.staging.padEnd(wStage)}  ${r.production.padEnd(wProd)}  ${r.drift}`,
    );
  }
  log.newline();
}

export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Show deployed versions and branch drift across repos')
    .argument('[repository]', 'Repository name (omit and pass --all for every repo)')
    .option('-a, --all', 'Report on every configured repo', false)
    .option('--no-fetch', 'Read local refs only — instant, but possibly stale')
    .option('--dir <path>', 'Override the local checkout path')
    .addHelpText(
      'after',
      `
Examples:
  $ vast status --all              every repo, one screen
  $ vast status VastPayPwa         one repo

Reads only — it fetches and reports, and changes nothing.

Columns:
  STAGING / PRODUCTION   the image tag deployed to each, from Helm values
  DRIFT                  commits waiting on develop that staging lacks
                         "no develop" means the repo has no promotion source
                         "n/a" means the repo has no Helm values to read
`,
    )
    .action(executeStatus);
}
