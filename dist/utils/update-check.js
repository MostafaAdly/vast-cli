/**
 * Background update check.
 *
 * Deliberately never blocks a command. The check runs AFTER the command has
 * finished, writes its result to a cache file, and the hint is printed on the
 * NEXT invocation. `status --all` was cut from 10.8s to 2.1s; a synchronous
 * version check would hand a chunk of that straight back.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { vastHome } from '../config/workspace.js';
const REPO = 'MostafaAdly/vast-cli';
const INTERVAL_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 3000;
function statePath() {
    return join(vastHome(), 'update-check.json');
}
export function readState() {
    const file = statePath();
    if (!existsSync(file))
        return null;
    try {
        return JSON.parse(readFileSync(file, 'utf-8'));
    }
    catch {
        return null;
    }
}
function writeState(state) {
    try {
        mkdirSync(vastHome(), { recursive: true });
        writeFileSync(statePath(), JSON.stringify(state), 'utf-8');
    }
    catch {
        // A cache we cannot write is not worth failing a command over.
    }
}
export function isDue(state, now) {
    if (!state)
        return true;
    return now - state.checkedAt >= INTERVAL_MS;
}
/** Strips a leading `v` so `v1.2.0` and `1.2.0` compare equal. */
export function normalize(version) {
    return version.trim().replace(/^v/, '');
}
/**
 * @returns the hint to show, or null when up to date or unknown.
 *
 * Reads only the cache — never the network — so calling it costs nothing.
 */
export function pendingHint(current) {
    const state = readState();
    if (!state?.latest)
        return null;
    if (normalize(state.latest) === normalize(current))
        return null;
    return `A newer Vast CLI is available (${normalize(state.latest)}, you have ${normalize(current)}). Run: vast upgrade`;
}
/**
 * Refresh the cache if a day has passed. Awaited only after the command's own
 * work is done, and every failure path is silent — an unreachable GitHub must
 * never turn into an error on an otherwise successful command.
 */
export async function refreshInBackground(now) {
    const state = readState();
    if (!isDue(state, now))
        return;
    let latest = null;
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
        const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
            signal: controller.signal,
            headers: { accept: 'application/vnd.github+json' },
        });
        clearTimeout(timer);
        if (res.ok) {
            const body = (await res.json());
            latest = body.tag_name ?? null;
        }
    }
    catch {
        latest = null;
    }
    // Record the attempt even when it failed, so a machine with no network does
    // not retry on every single command.
    writeState({ checkedAt: now, latest });
}
//# sourceMappingURL=update-check.js.map