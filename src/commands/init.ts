/**
 * Init Command
 *
 * Builds the repo map by walking the filesystem, so the CLI works on any
 * machine regardless of where repos were cloned or what they were named.
 */

import { Command } from 'commander';
import inquirer from 'inquirer';
import { REPOS } from '../config/repos.js';
import { readConfig, writeConfig } from '../config/workspace.js';
import { discover, defaultRoots } from '../utils/discover.js';
import { createHeader, createSpinner, log } from '../utils/ui.js';

/** Deterministic fallback: shortest path, ties broken by sort order. */
export function pickShortest(candidates: string[]): string {
  return [...candidates].sort((a, b) => a.length - b.length || a.localeCompare(b))[0];
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

  if (map.size === 0) {
    log.warn('No Vast repos found.');
    log.info('Clone what your team needs with:  vast clone --team frontend');
    writeConfig({ repos: {}, searchRoots: roots, discoveredAt: new Date().toISOString() });
    return;
  }

  const resolved = await resolveCandidates(map, Boolean(process.stdout.isTTY));

  writeConfig({
    repos: resolved,
    // Remember only roots that actually contained something.
    searchRoots: [...new Set(Object.values(resolved).map((p) => p.split('/').slice(0, -1).join('/')))],
    discoveredAt: new Date().toISOString(),
  });

  const found = Object.keys(resolved).length;
  log.success(`Found ${found} of ${REPOS.length} repos`);
  for (const [name, dir] of Object.entries(resolved)) {
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
