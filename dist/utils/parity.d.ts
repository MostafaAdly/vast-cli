/**
 * What one branch has that another lacks, by PR rather than by commit.
 *
 * Comparing commits is useless across these branches: merges, CI bumps and
 * cherry-picked hotfixes make staging and production differ by a hundred
 * commits that say nothing. A PR keeps its "Merge pull request #N" subject on
 * every branch it reaches, including as a cherry-picked copy, so PR numbers
 * are compared first. Whatever is left on one side is then checked by code:
 *
 *   1. patch-id against the other side's leftovers — a fix ported back under
 *      a new commit;
 *   2. patch-id against the other branch's history, for commits sharing an
 *      author date (cherry-picks and rebases keep it) — a duplicate of a
 *      change both branches already have;
 *   3. containment — the item's diff reverse-applies to the other branch's
 *      tip, so its exact post-image is there — a multi-commit PR ported
 *      commit by commit, or a change that arrived some other way.
 *
 * Any of the three marks the item ported. None of them is proof of absence:
 * a port that needed conflict fixes, or a change the other branch modified
 * further, still reads "not found".
 *
 * Git only: no network, and nothing written but a temporary index file.
 */
export interface PrUnit {
    number: number;
    branch: string;
    /** The merge commit, or the cherry-picked copy of it, on this side. */
    sha: string;
    landedAt: Date;
    /** Computed only for PRs left unmatched by number; null otherwise. */
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
/**
 * Which of these plain (non-merge) commits have their change present in
 * `ref`'s tree. Used for direct commits carried by an open release branch.
 */
export declare function containedIn(dir: string, ref: string, shas: string[]): Promise<Set<string>>;
export declare function compareBranches(dir: string, source: string, target: string): Promise<Parity>;
//# sourceMappingURL=parity.d.ts.map