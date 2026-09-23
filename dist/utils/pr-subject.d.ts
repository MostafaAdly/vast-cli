/**
 * What a commit subject says about the PR it came from.
 *
 * GitHub writes "Merge pull request #N from owner/branch" on every PR merge,
 * and a `--pick` hotfix keeps that subject on its cherry-picked copy, so the
 * subject is the one handle a PR keeps on every branch it reaches. The release
 * announcement and `vast pending` both read it here, so they can never
 * disagree on what counts as a PR or as pipeline noise.
 */
export interface PrSubject {
    number: number;
    /** The head branch without its owner: "feat/x", not "Vast-Menu/feat/x". */
    branch: string;
}
export declare function parsePrSubject(subject: string): PrSubject | null;
/**
 * The CI opens its own PRs to rewrite package.json's version on each branch.
 * They describe the pipeline, not the product.
 */
export declare function isBumpBranch(branch: string): boolean;
/**
 * PRs that carry other PRs rather than work of their own: release and hotfix
 * PRs into production, and the CI's bumps. Listing them would count every
 * change twice.
 */
export declare function isVehicleBranch(branch: string): boolean;
/**
 * Deploy bookkeeping the CI writes on every release, and merge subjects, which
 * describe how changes moved rather than what they are.
 */
export declare function isPipelineNoise(subject: string): boolean;
//# sourceMappingURL=pr-subject.d.ts.map