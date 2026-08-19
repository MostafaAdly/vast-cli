/**
 * Selective promotion: resolve user-supplied refs into cherry-pickable commits.
 *
 * A "ref" is anything a teammate would naturally paste: a commit SHA, a PR
 * number, or a GitHub link to either. Parsing is pure and lives here so the
 * ambiguity rules are testable; resolution (gh/git) is I/O and kept thin.
 *
 * The one deliberate ambiguity rule: a bare number is ALWAYS a PR number,
 * never a short SHA. An all-digit SHA prefix like `123456` is genuinely
 * ambiguous, so digits-only means PR, and a SHA must contain a letter or be
 * given as a commit link.
 */
export type ParsedPick = {
    kind: 'pr';
    number: number;
    repo?: string;
} | {
    kind: 'sha';
    sha: string;
    repo?: string;
};
export declare function parsePickRef(input: string): ParsedPick | null;
export interface ResolvedPick {
    /** What the user typed, for error messages. */
    input: string;
    sha: string;
    subject: string;
    /** Merge commits need `cherry-pick -m 1`. */
    isMerge: boolean;
    /** Commit time, used to apply picks in history order. */
    timestamp: number;
}
/**
 * Resolve, validate, and order picks. Returns every error at once rather than
 * failing on the first — a teammate fixing a list wants the whole list.
 *
 * Validations, in order of what they protect:
 * - a link's owner/repo must match the repo being promoted (paste guard)
 * - a PR must be merged and have a merge commit
 * - the commit must exist locally (fetch first)
 * - the commit must be reachable from origin/staging — production only ever
 *   receives staging-baked changes, and --pick does not get to break that
 * - the commit must NOT already be on origin/production (nothing to ship)
 */
export declare function resolvePicks(dir: string, org: string, repoName: string, inputs: string[]): {
    picks: ResolvedPick[];
    errors: string[];
};
//# sourceMappingURL=picks.d.ts.map