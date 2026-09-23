/**
 * What a commit subject says about the PR it came from.
 *
 * GitHub writes "Merge pull request #N from owner/branch" on every PR merge,
 * and a `--pick` hotfix keeps that subject on its cherry-picked copy, so the
 * subject is the one handle a PR keeps on every branch it reaches. The release
 * announcement and `vast pending` both read it here, so they can never
 * disagree on what counts as a PR or as pipeline noise.
 */
const MERGE_SUBJECT = /^Merge pull request #(\d+) from (\S+)/;
export function parsePrSubject(subject) {
    const m = MERGE_SUBJECT.exec(subject.trim());
    if (!m)
        return null;
    const slash = m[2].indexOf('/');
    return { number: Number(m[1]), branch: slash === -1 ? m[2] : m[2].slice(slash + 1) };
}
/**
 * The CI opens its own PRs to rewrite package.json's version on each branch.
 * They describe the pipeline, not the product.
 */
export function isBumpBranch(branch) {
    return /^bump-(stage|prod)-/.test(branch);
}
/**
 * PRs that carry other PRs rather than work of their own: release and hotfix
 * PRs into production, and the CI's bumps. Listing them would count every
 * change twice.
 */
export function isVehicleBranch(branch) {
    return isBumpBranch(branch) || /^(release|hotfix)\//.test(branch);
}
/**
 * Deploy bookkeeping the CI writes on every release, and merge subjects, which
 * describe how changes moved rather than what they are.
 */
export function isPipelineNoise(subject) {
    const s = subject.trim();
    return (/^chore:\s*bump version to /i.test(s) ||
        /^chore:\s*align package\.json version/i.test(s) ||
        /^Merge (branch|remote-tracking branch|pull request)/i.test(s));
}
//# sourceMappingURL=pr-subject.js.map