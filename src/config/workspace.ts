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

export function cachedRepoPath(name: string): string | undefined {
  return readConfig().repos[name];
}
