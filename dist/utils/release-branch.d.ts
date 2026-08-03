/**
 * The production code path: a reviewed release/X.Y.Z or hotfix/X.Y.Z pull
 * request.
 *
 * Production is never merged into directly. The branch is cut from production,
 * staging is merged into it, and a PR is opened for review. Merging that PR is
 * a human action — nothing here does it, and nothing here can.
 *
 * Preparing a release is deliberately NOT gated on the production lock: cutting
 * a branch and opening a PR ships nothing. The lock guards the deploy that
 * comes after the PR is merged.
 */
declare function readVersionField(json: string): string | null;
declare function setVersionField(json: string, version: string): string;
/** Exported for tests only — these are internals, not API. */
export declare const __testing: {
    readVersionField: typeof readVersionField;
    setVersionField: typeof setVersionField;
};
/** A planned promotion, or an urgent one. Differs only in naming. */
export type ReleaseKind = 'release' | 'hotfix';
export declare const RELEASE_KINDS: ReleaseKind[];
export declare function releaseBranchName(kind: ReleaseKind, version: string): string;
/** @returns the PR URL, or null if nothing was opened. */
export declare function cutReleaseBranch(dir: string, repo: string, kind: ReleaseKind, version: string, dryRun: boolean): string | null;
export {};
//# sourceMappingURL=release-branch.d.ts.map