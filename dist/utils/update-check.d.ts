/**
 * Background update check.
 *
 * Deliberately never blocks a command. The check runs AFTER the command has
 * finished, writes its result to a cache file, and the hint is printed on the
 * NEXT invocation. `status --all` was cut from 10.8s to 2.1s; a synchronous
 * version check would hand a chunk of that straight back.
 */
interface CheckState {
    /** When the last check ran, epoch ms. */
    checkedAt: number;
    /** Latest release tag seen, or null if the check failed. */
    latest: string | null;
}
export declare function readState(): CheckState | null;
export declare function isDue(state: CheckState | null, now: number): boolean;
/** Strips a leading `v` so `v1.2.0` and `1.2.0` compare equal. */
export declare function normalize(version: string): string;
/**
 * @returns the hint to show, or null when up to date or unknown.
 *
 * Reads only the cache — never the network — so calling it costs nothing.
 */
export declare function isNewer(candidate: string, current: string): boolean;
export declare function pendingHint(current: string): string | null;
/**
 * Refresh the cache if a day has passed. Awaited only after the command's own
 * work is done, and every failure path is silent — an unreachable GitHub must
 * never turn into an error on an otherwise successful command.
 */
export declare function refreshInBackground(now: number): Promise<void>;
export {};
//# sourceMappingURL=update-check.d.ts.map