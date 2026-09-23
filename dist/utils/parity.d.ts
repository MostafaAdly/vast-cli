/**
 * What one branch has that another lacks, by PR rather than by commit.
 *
 * Comparing commits is useless across these branches: merges, CI bumps and
 * cherry-picked hotfixes make staging and production differ by a hundred
 * commits that say nothing. A PR keeps its "Merge pull request #N" subject on
 * every branch it reaches, including as a cherry-picked copy, so PR numbers
 * are compared first. Whatever is left on one side is then checked by code
 * content (patch-id), which catches a fix ported back under a new commit.
 *
 * Git only: no network, nothing written.
 */
export interface PrUnit {
    number: number;
    branch: string;
    /** The merge commit, or the cherry-picked copy of it, on this side. */
    sha: string;
    landedAt: Date;
    patchId: string | null;
}
export interface DirectCommit {
    sha: string;
    subject: string;
    landedAt: Date;
    patchId: string | null;
}
export interface Side {
    prs: PrUnit[];
    direct: DirectCommit[];
    /** SHAs of items whose code is already on the other side under another commit. */
    ported: Set<string>;
}
export interface Parity {
    source: string;
    target: string;
    onlySource: Side;
    onlyTarget: Side;
    sharedPrs: number[];
}
export declare function compareBranches(dir: string, source: string, target: string): Parity;
//# sourceMappingURL=parity.d.ts.map