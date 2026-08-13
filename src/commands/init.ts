/**
 * Init Command
 *
 * Builds the repo map by walking the filesystem, so the CLI works on any
 * machine regardless of where repos were cloned or what they were named.
 */

import { existsSync } from 'fs';
import { dirname } from 'path';
import { Command } from 'commander';
import inquirer from 'inquirer';
import { REPOS } from '../config/repos.js';
import { readConfig, writeConfig } from '../config/workspace.js';
import { discover, defaultRoots, originOf, pickShortest } from '../utils/discover.js';
import { canonicalRepoName } from '../utils/remote.js';
import { createHeader, createSpinner, log } from '../utils/ui.js';

/**
 * Fold this scan's results into what was already known.
 *
 * A scan sees only `searchRoots`, so replacing the map wholesale deletes every
 * repo that lives outside them — `vast clone --into ~/side` followed by a plain
 * `vast init` used to lose the lot. Discovery wins for what it found; anything
 * it did not find survives only if that path still exists AND still resolves to
 * that repo, so genuinely stale entries are still cleared out.
 */
export function mergeRepos(
  existing: Record<string, string>,
  discovered: Record<string, string>,
): Record<string, string> {
  const merged: Record<string, string> = { ...discovered };

  for (const [name, dir] of Object.entries(existing)) {
    if (merged[name]) continue;
    if (!existsSync(dir)) continue;
    const origin = originOf(dir);
    if (origin && canonicalRepoName(origin) === name) merged[name] = dir;
  }

  return merged;
}

export async function resolveCandidates(
  map: Map<string, string[]>,
  interactive: boolean,
): Promise<Record<string, string>> {
  const resolved: Record<string, string> = {};

  for (const [name, candidates] of [...map].sort(([a], [b]) => a.localeCompare(b))) {
    if (candidates.length === 1) {
      resolved[name] = candidates[0];
      continue;
    }

    if (!interactive) {
      resolved[name] = pickShortest(candidates);
      log.warn(`${name}: ${candidates.length} checkouts found, using ${resolved[name]}`);
      continue;
    }

    const { chosen } = await inquirer.prompt([
      {
        type: 'list',
        name: 'chosen',
        message: `${name} has ${candidates.length} checkouts. Which one?`,
        choices: candidates,
      },
    ]);
    resolved[name] = chosen;
  }

  return resolved;
}

async function executeInit(options: { rescan: boolean }): Promise<void> {
  console.log(createHeader('Init', 'locating your Vast repos'));

  const existing = readConfig();
  const roots = !options.rescan && existing.searchRoots.length ? existing.searchRoots : defaultRoots();

  const spinner = process.stdout.isTTY ? createSpinner('Scanning for checkouts...').start() : null;
  const map = discover(roots);
  spinner?.stop();

  const scanned = await resolveCandidates(map, Boolean(process.stdout.isTTY));
  const resolved = mergeRepos(existing.repos, scanned);

  // Remember only roots that actually contain something — including the ones
  // surviving entries live in, which is how a `--into` destination stays known.
  // With nothing found at all, keep what we swept so the next run is no blinder.
  const parents = [...new Set(Object.values(resolved).map((p) => dirname(p)))];
  writeConfig({
    repos: resolved,
    searchRoots: parents.length ? parents : roots,
    discoveredAt: new Date().toISOString(),
  });

  if (Object.keys(resolved).length === 0) {
    log.warn('No Vast repos found.');
    log.info('Clone what your team needs with:  vast clone --team frontend');
    return;
  }

  const found = Object.keys(resolved).length;
  log.success(`Found ${found} of ${REPOS.length} repos`);
  for (const [name, dir] of Object.entries(resolved).sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`  ${name.padEnd(22)} ${log.dim(dir)}`);
  }

  const missing = REPOS.filter((r) => !resolved[r.name]).map((r) => r.name);
  if (missing.length) {
    log.newline();
    log.muted(`Not found: ${missing.join(', ')}`);
    log.muted('Clone them with:  vast clone --team <frontend|backend|infra|all>');
  }
}

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Find your Vast checkouts and remember where they are')
    .option('--rescan', 'Search from scratch instead of known roots', false)
    .addHelpText(
      'after',
      `
Repos are matched by their origin remote, not their folder name, so it does not
matter what you called them or where you put them.

  $ vast init             scan and remember
  $ vast init --rescan    search everywhere again, e.g. after moving a repo
`,
    )
    .action(executeInit);
}
