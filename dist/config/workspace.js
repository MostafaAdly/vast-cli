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
import { discover, defaultRoots, originOf } from '../utils/discover.js';
const EMPTY = { repos: {}, searchRoots: [] };
/** Shared with production-lock.ts so tests can sandbox both at once. */
export function vastHome() {
    return process.env.VAST_CLI_HOME ?? join(homedir(), '.vast-cli');
}
export function configPath() {
    return join(vastHome(), 'config.json');
}
export function readConfig() {
    const file = configPath();
    if (!existsSync(file))
        return { ...EMPTY };
    try {
        const parsed = JSON.parse(readFileSync(file, 'utf-8'));
        return {
            repos: parsed.repos ?? {},
            searchRoots: parsed.searchRoots ?? [],
            discoveredAt: parsed.discoveredAt,
        };
    }
    catch {
        // A hand-edited or truncated file must not brick every command.
        return { ...EMPTY };
    }
}
export function writeConfig(config) {
    const file = configPath();
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
}
export function setRepoPath(name, dir) {
    const config = readConfig();
    config.repos[name] = dir;
    writeConfig(config);
}
export function cachedRepoPath(name) {
    return readConfig().repos[name];
}
/**
 * Absolute path of a repo's checkout, or null if it is not on this machine.
 *
 * Trusts the cache only when the directory still exists AND still has a
 * matching origin — a moved or repurposed clone must not become a permanent
 * dead end. On a miss it re-scans and repairs the entry for just this repo.
 */
export function resolveRepoDir(name) {
    const config = readConfig();
    const cached = config.repos[name];
    if (cached && existsSync(cached)) {
        const origin = originOf(cached);
        if (origin && canonicalRepoName(origin) === name)
            return cached;
    }
    const roots = config.searchRoots.length ? config.searchRoots : defaultRoots();
    const found = discover(roots).get(name);
    if (!found?.length)
        return null;
    const dir = [...found].sort((a, b) => a.length - b.length || a.localeCompare(b))[0];
    setRepoPath(name, dir);
    return dir;
}
//# sourceMappingURL=workspace.js.map