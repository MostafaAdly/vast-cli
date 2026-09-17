/**
 * Status Command
 *
 * Read-only. Reports, per repo, what is deployed to staging and production and
 * how far apart the long-lived branches have drifted — replacing the
 * checkout-pull-look loop.
 */

import { Command } from 'commander';
import { existsSync } from 'fs';
import { join } from 'path';
import { DEPLOY_ENVS, REPOS, getRepo, isReleasable, type DeployEnv, type RepoConfig } from '../config/repos.js';
import { repoDir } from '../config/workspace.js';
import { deployedTag } from '../utils/deployments.js';
import { fetchBranches, aheadBehind } from '../utils/git.js';
import { createHeader, createSpinner, log } from '../utils/ui.js';

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
 * @param dirs each target's resolved path (or null), pre-computed by the
 * caller — resolution runs a subprocess and, on a cache miss, a full disk
 * walk, so it must happen exactly once per repo, not once per call site.
 * @returns names of repos whose fetch failed.
 */
async function refreshAll(targets: RepoConfig[], dirs: Map<string, string | null>): Promise<Set<string>> {
  const failed = new Set<string>();
  await Promise.all(
    targets.map(async (repo) => {
      const dir = dirs.get(repo.name) ?? null;
      if (!dir || !existsSync(join(dir, '.git'))) return;
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

/**
 * The deployed tag per env, for every repo at once.
 *
 * Each read is one `gh api` call against Vast-deployments — the app checkouts
 * no longer carry the answer — so they run concurrently: serially this is one
 * round trip per repo per env and the command stops feeling instant. A repo
 * that is not deployed to an env reads "n/a"; a read that fails reads "?",
 * because a broken lookup is not the same claim as "nothing is deployed".
 */
export type TagReader = (repo: RepoConfig, env: DeployEnv) => Promise<string>;

/** The reader's own wording for "that file is not in the repo" (see deployments.ts). */
const MISSING_FILE = /^no .* in Vast-deployments$/;

export async function readTags(
  targets: RepoConfig[],
  read: TagReader = deployedTag,
): Promise<Map<string, Record<DeployEnv, string>>> {
  const entries = await Promise.all(
    targets.map(async (repo) => {
      const tags = { staging: 'n/a', production: 'n/a' } as Record<DeployEnv, string>;
      await Promise.all(
        DEPLOY_ENVS.map(async (env) => {
          if (!repo.deployments[env]) return;
          try {
            tags[env] = await read(repo, env);
          } catch (error) {
            // A folder that is not there yet is the normal state while
            // production is unmigrated — a question mark would read as a
            // failure and send someone chasing a network problem.
            const message = error instanceof Error ? error.message : String(error);
            tags[env] = MISSING_FILE.test(message) ? 'not migrated' : '?';
          }
        }),
      );
      return [repo.name, tags] as const;
    }),
  );
  return new Map(entries);
}

function inspect(
  repo: RepoConfig,
  dir: string | null,
  fetchFailed: boolean,
  tags: Record<DeployEnv, string>,
): Row {
  // The tags come from Vast-deployments, so they are known even for a repo that
  // is not cloned; only the drift column needs a checkout.
  if (!dir || !existsSync(join(dir, '.git'))) {
    return { name: repo.name, staging: tags.staging, production: tags.production, drift: 'not cloned' };
  }

  let drift: string;
  const source = repo.promoteFrom.staging;
  if (fetchFailed) {
    drift = 'fetch failed';
  } else if (!source) {
    drift = 'no develop';
  } else {
    try {
      const { ahead } = aheadBehind(dir, `origin/${source}`, 'origin/staging');
      drift = ahead === 0 ? 'in sync' : `${source} +${ahead}`;
    } catch {
      drift = '?';
    }
  }

  return { name: repo.name, staging: tags.staging, production: tags.production, drift };
}

async function executeStatus(
  repoName: string | undefined,
  options: { all: boolean; dir?: string; fetch: boolean },
): Promise<void> {
  const targets = repoName
    ? [getRepo(repoName)].filter((r): r is RepoConfig => Boolean(r))
    : options.all
      ? REPOS.filter(isReleasable)
      : [];

  if (targets.length === 0) {
    log.error(repoName ? `Unknown repository: ${repoName}` : 'Specify a repository or --all');
    process.exit(1);
  }

  // Resolved once per repo and shared by refreshAll and inspect — resolution
  // runs a subprocess and, on a cache miss, a full disk walk, so calling it
  // twice per repo would double that cost (or worse, double the walks).
  const dirs = new Map(targets.map((r) => [r.name, repoDir(r, options.dir)]));

  let fetchFailed = new Set<string>();
  if (options.fetch) {
    // Only animate on a terminal — piped output would keep the spinner's text
    // as a stray line.
    const spinner = process.stdout.isTTY
      ? createSpinner(`Refreshing ${targets.length} repo(s)...`).start()
      : null;
    fetchFailed = await refreshAll(targets, dirs);
    spinner?.stop();
  }

  console.log(createHeader('Release Status', options.fetch ? 'Vast Group' : 'Vast Group (local refs)'));

  const tags = await readTags(targets);
  const rows = targets.map((r) =>
    inspect(r, dirs.get(r.name) ?? null, fetchFailed.has(r.name), tags.get(r.name)!),
  );

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
    .option('--no-fetch', 'Skip the git fetch — DRIFT may be stale (tags are always read live)')
    .option('--dir <path>', 'Override the local checkout path')
    .addHelpText(
      'after',
      `
Examples:
  $ vast status --all              every repo, one screen
  $ vast status VastPayPwa         one repo

Reads only — it fetches and reports, and changes nothing.

Columns:
  STAGING / PRODUCTION   the image tag ArgoCD is running, read from the
                         Vast-deployments values file for that environment
                         "n/a" means the repo is not deployed to that env
                         "not migrated" means the file is not in Vast-deployments yet
                         "?"   means the file could not be read
  DRIFT                  commits waiting on develop that staging lacks
                         "no develop" means the repo has no promotion source
                         "not cloned" means the drift cannot be computed here

The tags come from Vast-deployments over the API, so they are reported even for
a repo you have not cloned. Only DRIFT needs a local checkout.
`,
    )
    .action(executeStatus);
}
