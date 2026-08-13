/**
 * Clone Command
 *
 * Gets a new teammate from nothing to a working checkout set in one command.
 * Clones through `gh`, so authentication and the user's preferred protocol come
 * for free — and everyone using this CLI already has `gh` authenticated.
 */

import { Command } from 'commander';
import inquirer from 'inquirer';
import { execFileSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { getRepo, reposForTeam, TEAMS, type RepoConfig } from '../config/repos.js';
import { resolveRepoDir, setRepoPath } from '../config/workspace.js';
import { readConfig } from '../config/workspace.js';
import { ORG } from '../utils/remote.js';
import { createHeader, createErrorBox, log } from '../utils/ui.js';

/** The directory most of the known checkouts already sit in. */
export function commonParent(paths: string[]): string | null {
  if (paths.length === 0) return null;
  const counts = new Map<string, number>();
  for (const p of paths) {
    const parent = dirname(p);
    counts.set(parent, (counts.get(parent) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
}

async function chooseDestination(explicit?: string): Promise<string> {
  if (explicit) return explicit;

  const suggestion = commonParent(Object.values(readConfig().repos));
  if (!process.stdout.isTTY) {
    if (suggestion) return suggestion;
    throw new Error('No destination. Pass --into <path>.');
  }

  const { dir } = await inquirer.prompt([
    {
      type: 'input',
      name: 'dir',
      message: 'Clone into which directory?',
      default: suggestion ?? join(process.env.HOME ?? '.', 'work'),
    },
  ]);
  return dir;
}

async function executeClone(
  repoName: string | undefined,
  options: { team?: string; into?: string; dryRun: boolean },
): Promise<void> {
  let targets: RepoConfig[];

  if (repoName) {
    const repo = getRepo(repoName);
    if (!repo) {
      log.error(`Unknown repository: ${repoName}`);
      process.exit(1);
    }
    targets = [repo];
  } else if (options.team) {
    if (!TEAMS.includes(options.team)) {
      log.error(`Unknown team: ${options.team}. Use ${TEAMS.join(', ')}.`);
      process.exit(1);
    }
    targets = reposForTeam(options.team);
  } else {
    log.error(`Specify a repository or --team <${TEAMS.join('|')}>`);
    process.exit(1);
  }

  const missing = targets.filter((r) => resolveRepoDir(r.name) === null);
  const present = targets.length - missing.length;

  console.log(createHeader('Clone', `${targets.length} repo(s) | ${present} already present`));

  if (missing.length === 0) {
    log.success('Nothing to clone — you already have all of them.');
    return;
  }

  let into: string;
  try {
    into = await chooseDestination(options.into);
  } catch (error) {
    console.log(createErrorBox('Nowhere to clone into', error instanceof Error ? error.message : ''));
    process.exit(1);
  }

  for (const repo of missing) {
    const dest = join(into, repo.name);
    if (options.dryRun) {
      log.muted(`  would clone ${repo.name} -> ${dest}`);
      continue;
    }

    if (existsSync(dest)) {
      log.warn(`${repo.name}: ${dest} already exists, skipping`);
      continue;
    }

    mkdirSync(into, { recursive: true });
    try {
      execFileSync('gh', ['repo', 'clone', `${ORG}/${repo.name}`, dest], { stdio: 'inherit' });
      setRepoPath(repo.name, dest);
      log.success(`${repo.name} -> ${dest}`);
    } catch {
      log.error(`${repo.name}: clone failed`);
    }
  }
}

export function registerCloneCommand(program: Command): void {
  program
    .command('clone')
    .description('Clone the repos your team needs that you do not already have')
    .argument('[repository]', 'A single repository (omit and pass --team)')
    .option('-t, --team <team>', `Team profile: ${TEAMS.join(', ')}`)
    .option('--into <path>', 'Directory to clone into')
    .option('-n, --dry-run', 'Show what would be cloned', false)
    .addHelpText(
      'after',
      `
Only clones what you are missing — repos you already have anywhere on disk are
left alone.

  $ vast clone --team frontend
  $ vast clone --team backend --into ~/work
  $ vast clone --team all --dry-run
  $ vast clone VastPayPwa

Teams:
  frontend   the PWAs, dashboards, and payments UI
  backend    the two PHP backends and the Odoo payment integration
  infra      Terraform
  all        everything above
`,
    )
    .action(executeClone);
}
