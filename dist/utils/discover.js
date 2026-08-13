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
export function findCheckouts(root, maxDepth = MAX_DEPTH) {
    const found = [];
    const walk = (dir, depth) => {
        if (depth > maxDepth)
            return;
        let entries;
        try {
            entries = readdirSync(dir, { withFileTypes: true });
        }
        catch {
            return; // unreadable (permissions, broken symlink) — skip quietly
        }
        if (entries.some((e) => e.name === '.git')) {
            found.push(dir);
            return; // a checkout does not contain other checkouts we care about
        }
        for (const entry of entries) {
            // Symlinks are skipped as a consequence: with `withFileTypes`, a symlink
            // to a directory reports isDirectory() === false (the type comes from
            // the link itself, not its target). Deliberate — following them invites
            // cycles and duplicate checkouts. Do not "fix" this by resolving links.
            if (!entry.isDirectory())
                continue;
            if (PRUNE.has(entry.name))
                continue;
            walk(join(dir, entry.name), depth + 1);
        }
    };
    if (existsSync(root))
        walk(root, 0);
    return found;
}
export function originOf(dir) {
    try {
        return execFileSync('git', ['remote', 'get-url', 'origin'], {
            cwd: dir,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
    }
    catch {
        return null;
    }
}
/**
 * Per-process memo of {@link discover}, keyed by the roots swept.
 *
 * A sweep walks every root and spawns `git remote get-url` per checkout found,
 * so it is by far the most expensive thing this CLI does. Callers resolve many
 * repos in one run (`vast clone --team all` resolves 12, `deploy --all` one per
 * repo) and every one of them would otherwise re-walk the whole disk.
 *
 * Process-scoped on purpose: a single command run sees a consistent filesystem,
 * and nothing is carried across runs.
 */
const sweeps = new Map();
/** Forget memoized sweeps — for tests that create checkouts between calls. */
export function clearDiscoveryCache() {
    sweeps.clear();
}
/**
 * @returns canonical repo name -> every checkout claiming it. More than one is
 * a real state, not an error, so all candidates are kept for the caller to
 * resolve.
 *
 * Memoized per process; call {@link clearDiscoveryCache} after creating or
 * cloning a checkout. The returned map is shared, so callers must not mutate it.
 */
export function discover(roots) {
    // NUL joins the sorted roots because it is the one byte a path cannot
    // contain, so two different root lists can never collide on one key.
    const key = [...roots].sort().join('\0');
    const memo = sweeps.get(key);
    if (memo)
        return memo;
    const map = new Map();
    for (const root of roots) {
        for (const dir of findCheckouts(root)) {
            const origin = originOf(dir);
            if (!origin)
                continue;
            const name = canonicalRepoName(origin);
            if (!name)
                continue;
            map.set(name, [...(map.get(name) ?? []), dir]);
        }
    }
    sweeps.set(key, map);
    return map;
}
/**
 * Deterministic pick when several checkouts claim one repo: shortest path,
 * ties broken by sort order.
 *
 * Shared by `vast init`'s non-interactive fallback and the lazy repair in
 * workspace.ts, which must agree — a repair that picked differently from init
 * would silently move a repo out from under the user.
 */
export function pickShortest(candidates) {
    return [...candidates].sort((a, b) => a.length - b.length || a.localeCompare(b))[0];
}
/** $HOME-relative likely roots, as absolute paths that exist. */
export function defaultRoots() {
    return LIKELY_ROOTS.map((r) => join(homedir(), r)).filter((p) => existsSync(p));
}
//# sourceMappingURL=discover.js.map