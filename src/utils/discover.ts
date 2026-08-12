/**
 * Finds Vast checkouts on this machine.
 *
 * Teammates keep repos in scattered locations rather than under one parent, so
 * discovery walks several likely roots and identifies each checkout by its
 * `origin` remote. Directory names are never trusted.
 */

import { execFileSync } from 'child_process';
import { existsSync, readdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { canonicalRepoName } from './remote.js';

/** Directory names, relative to $HOME, checked before sweeping wider. */
export const LIKELY_ROOTS = [
  'Workshop',
  'work',
  'Work',
  'projects',
  'Projects',
  'Developer',
  'dev',
  'src',
  'code',
  'repos',
  'Desktop',
  'Documents',
];

/** Never descended into. Big, and never contains a Vast checkout. */
export const PRUNE = new Set([
  'node_modules',
  '.git',
  'Library',
  '.Trash',
  '.cache',
  '.npm',
  '.nvm',
  'vendor',
  'dist',
  'build',
  '.next',
  'Applications',
  'Pictures',
  'Music',
  'Movies',
]);

export const MAX_DEPTH = 4;

/** Absolute paths of directories that are git checkouts. */
export function findCheckouts(root: string, maxDepth = MAX_DEPTH): string[] {
  const found: string[] = [];

  const walk = (dir: string, depth: number): void => {
    if (depth > maxDepth) return;

    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // unreadable (permissions, broken symlink) — skip quietly
    }

    if (entries.some((e) => e.name === '.git')) {
      found.push(dir);
      return; // a checkout does not contain other checkouts we care about
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      if (PRUNE.has(entry.name)) continue;
      walk(join(dir, entry.name), depth + 1);
    }
  };

  if (existsSync(root)) walk(root, 0);
  return found;
}

export function originOf(dir: string): string | null {
  try {
    return execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd: dir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * @returns canonical repo name -> every checkout claiming it. More than one is
 * a real state, not an error, so all candidates are kept for the caller to
 * resolve.
 */
export function discover(roots: string[]): Map<string, string[]> {
  const map = new Map<string, string[]>();

  for (const root of roots) {
    for (const dir of findCheckouts(root)) {
      const origin = originOf(dir);
      if (!origin) continue;
      const name = canonicalRepoName(origin);
      if (!name) continue;
      map.set(name, [...(map.get(name) ?? []), dir]);
    }
  }

  return map;
}

/** $HOME-relative likely roots, as absolute paths that exist. */
export function defaultRoots(): string[] {
  return LIKELY_ROOTS.map((r) => join(homedir(), r)).filter((p) => existsSync(p));
}
