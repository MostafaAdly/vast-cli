/**
 * Git operations for the release chain.
 *
 * Conflict detection uses `git merge-tree --write-tree`, which computes the
 * merge in memory. Nothing is checked out and the index is never touched, so a
 * refused promotion cannot strand a half-merged working tree.
 */
/**
 * Branches this CLI must never push to.
 *
 * `production` is here as a hard backstop independent of the production lock:
 * even with the lock lifted, production is reached through a reviewed
 * release/X.Y.Z pull request, never a direct push from this tool.
 */
export declare const NEVER_PUSH: string[];
export declare function isClean(dir: string): boolean;
export declare function fetch(dir: string): void;
/** Commits `a` has that `b` lacks, and vice versa. */
export declare function aheadBehind(dir: string, a: string, b: string): {
    ahead: number;
    behind: number;
};
export interface TrialMergeResult {
    clean: boolean;
    /** Paths that conflict. Empty when clean. */
    conflicts: string[];
}
/** Computes the merge in memory. Never mutates the working tree or index. */
export declare function trialMerge(dir: string, into: string, from: string): TrialMergeResult;
/**
 * Merge `from` into `into` and push.
 *
 * Refuses outright for any branch in NEVER_PUSH. Only call after trialMerge
 * reports clean.
 */
export declare function mergeAndPush(dir: string, into: string, from: string): void;
//# sourceMappingURL=git.d.ts.map