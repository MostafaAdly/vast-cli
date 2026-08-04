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
import { fetch as gitFetch, aheadBehind } from '../utils/git.js';
import { createHeader, log } from '../utils/ui.js';

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

function inspect(repo: RepoConfig, dir: string): Row {
  if (!existsSync(join(dir, '.git'))) {
    return { name: repo.name, staging: '—', production: '—', drift: 'not cloned' };
  }

  try {
    gitFetch(dir);
  } catch {
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
  options: { all: boolean; dir?: string },
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

  console.log(createHeader('Release Status', 'Vast Group'));

  const rows = targets.map((r) => inspect(r, repoDir(r, options.dir)));
  const width = Math.max(...rows.map((r) => r.name.length), 4);

  console.log(`  ${'REPO'.padEnd(width)}  ${'STAGING'.padEnd(14)}  ${'PRODUCTION'.padEnd(14)}  DRIFT`);
  for (const r of rows) {
    console.log(
      `  ${r.name.padEnd(width)}  ${r.staging.padEnd(14)}  ${r.production.padEnd(14)}  ${r.drift}`,
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
