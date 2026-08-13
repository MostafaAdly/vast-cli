/**
 * Per-user configuration: which repo lives where.
 *
 * A resolved name→path map rather than a single workspace root, because
 * teammates keep Vast repos in scattered locations rather than under one
 * parent.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import { canonicalRepoName } from '../utils/remote.js';
import { discover, defaultRoots, originOf, pickShortest } from '../utils/discover.js';
import type { RepoConfig } from './repos.js';

export interface VastConfig {
  /** Canonical repo name -> absolute path of the checkout. */
  repos: Record<string, string>;
  /** Directories discovery has previously found repos in. */
  searchRoots: string[];
  discoveredAt?: string;
}

const EMPTY: VastConfig = { repos: {}, searchRoots: [] };

/** Shared with production-lock.ts so tests can sandbox both at once. */
export function vastHome(): string {
  return process.env.VAST_CLI_HOME ?? join(homedir(), '.vast-cli');
}

export function configPath(): string {
  return join(vastHome(), 'config.json');
}

export function readConfig(): VastConfig {
  const file = configPath();
  if (!existsSync(file)) return { ...EMPTY };
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as Partial<VastConfig>;
    return {
      repos: parsed.repos ?? {},
      searchRoots: parsed.searchRoots ?? [],
      discoveredAt: parsed.discoveredAt,
    };
  } catch {
    // A hand-edited or truncated file must not brick every command.
    return { ...EMPTY };
  }
}

export function writeConfig(config: VastConfig): void {
  const file = configPath();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
}

export function setRepoPath(name: string, dir: string): void {
  const config = readConfig();
  config.repos[name] = dir;
  writeConfig(config);
}

/** Drop an entry that no longer describes anything on this machine. */
export function forgetRepoPath(name: string): void {
  const config = readConfig();
  if (!(name in config.repos)) return;
  delete config.repos[name];
  writeConfig(config);
}

/**
 * Remember a directory future discovery must sweep.
 *
 * `vast clone --into ~/side` puts repos somewhere no heuristic would guess, so
 * the destination has to be recorded or the next `vast init` cannot see them.
 */
export function addSearchRoot(dir: string): void {
  const config = readConfig();
  if (config.searchRoots.includes(dir)) return;
  config.searchRoots.push(dir);
  writeConfig(config);
}

export function cachedRepoPath(name: string): string | undefined {
  return readConfig().repos[name];
}

/**
 * Absolute path of a repo's checkout, or null if it is not on this machine.
 *
 * Trusts the cache only when the directory still exists AND still has a
 * matching origin — a moved or repurposed clone must not become a permanent
 * dead end. On a miss it re-scans and repairs the entry for just this repo;
 * persisting that repair is the point, so later runs skip the sweep entirely.
 *
 * When the re-scan also comes up empty, the dead entry is deleted rather than
 * left to fail the same way on every future call.
 */
export function resolveRepoDir(name: string): string | null {
  const config = readConfig();
  const cached = config.repos[name];

  if (cached && existsSync(cached)) {
    const origin = originOf(cached);
    if (origin && canonicalRepoName(origin) === name) return cached;
  }

  const roots = config.searchRoots.length ? config.searchRoots : defaultRoots();
  const found = discover(roots).get(name);
  if (!found?.length) {
    if (cached !== undefined) forgetRepoPath(name);
    return null;
  }

  const dir = pickShortest(found);
  setRepoPath(name, dir);
  return dir;
}

/**
 * A repo's checkout path, honouring an explicit `--dir` override.
 *
 * The one resolution entry point for commands — `status`, `promote`, `deploy`,
 * and `release` all need exactly this, and two spellings of it drifted apart
 * once already.
 */
export function repoDir(repo: RepoConfig, override?: string): string | null {
  return override ?? resolveRepoDir(repo.name);
}
