/**
 * The production code path: a reviewed release/X.Y.Z pull request.
 *
 * Production is never merged into directly. The branch is cut from production,
 * staging is merged into it, and a PR is opened for review. Merging that PR is
 * a human action — nothing here does it, and nothing here can.
 */
export declare function releaseBranchName(version: string): string;
/** @returns the PR URL, or null if nothing was opened. */
export declare function cutReleaseBranch(dir: string, repo: string, version: string, dryRun: boolean): string | null;
//# sourceMappingURL=release-branch.d.ts.map