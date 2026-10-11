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
import { type BodyMode } from './changelog.js';
import type { ResolvedPick, BranchMerge } from './picks.js';
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
/**
 * What a cut did. `url` is the opened PR (null on a dry run or a refusal);
 * `problem` says why it refused, and is null whenever it did not — so a dry run
 * that would refuse reads as a refusal, not as a PR that would open.
 */
export interface CutResult {
    url: string | null;
    problem: string | null;
}
/** @returns the PR URL, or why the branch could not be cut. */
export declare function cutReleaseBranch(dir: string, repo: string, kind: ReleaseKind, version: string, dryRun: boolean, bodyMode?: BodyMode): CutResult;
/**
 * The selective path: cut <kind>/<version> from production and cherry-pick the
 * chosen commits onto it, instead of merging staging wholesale.
 *
 * All or nothing. A conflict aborts the pick, restores the original branch,
 * and deletes the temp branch — the checkout ends exactly where it started.
 *
 * A dry run applies nothing, so it cannot see a pick conflict: its `problem`
 * is always null.
 *
 * @returns the PR URL, or why the branch could not be cut.
 */
export declare function cutPickedBranch(dir: string, repo: string, kind: ReleaseKind, version: string, picks: ResolvedPick[], dryRun: boolean, bodyMode?: BodyMode, merges?: BranchMerge[]): CutResult;
export {};
//# sourceMappingURL=release-branch.d.ts.map