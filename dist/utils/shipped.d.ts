/**
 * What actually shipped in a release, expressed as the PRs it carries.
 *
 * The Slack announcement is read by people who do not read commit logs, so it
 * is built from PRs and the people who wrote them rather than from raw
 * subjects. The PR numbers come out of the commit subjects already in the
 * branch — the same
 * source `skills/release/notes.sh` uses, and for the same reason: `gh search
 * commits` only indexes a repo's default branch, which here is `production`,
 * so it is blind to everything a release is made of.
 *
 * Every function here degrades rather than throws. The PR is already open by
 * the time any of this runs; a failed lookup costs the message a line, and
 * must never cost the release its announcement.
 */
import type { ResolvedPick } from './picks.js';
import { type Contributor } from './contributors.js';
/**
 * A PR as the announcement uses it. Defined here, next to the code that fills
 * it in, so the message builder depends on the data and not the other way
 * round.
 */
export interface ShippedPr {
    number: number;
    title: string;
    url: string;
    branch: string;
    /** PR author first, then everyone else who wrote its commits. */
    contributors: Contributor[];
}
/** How a PR number becomes the PR itself. Injectable so tests never touch gh. */
export interface PrLookup {
    (repo: string, number: number): Promise<Omit<ShippedPr, 'number'> | null>;
}
/**
 * PR numbers carried by `head` that `base` does not have.
 *
 * Every commit is read, not just `--merges`. A hotfix built with `--pick`
 * carries each PR as a cherry-pick of its merge commit: an ordinary one-parent
 * commit whose subject still reads "Merge pull request #328 from …". Reading
 * only real merges found nothing on such a branch, and the announcement fell
 * back to raw subjects with nobody credited.
 */
export declare function prNumbersInRange(dir: string, base: string, head: string): number[];
/**
 * PR numbers carried by a selective promotion.
 *
 * A `--pick` of a PR resolves to that PR's merge commit, so its subject names
 * the PR just as the range version does. Picks that are plain commits simply
 * contribute nothing.
 */
export declare function prNumbersOfPicks(picks: ResolvedPick[]): number[];
/**
 * `gh pr view --json number,title,url,author,headRefName,commits` output ->
 * the PR as the announcement needs it. Null when the output is not a PR.
 */
export declare function parseGhPrView(json: string): Omit<ShippedPr, 'number'> | null;
export declare function buildPrQuery(numbers: number[]): string;
/**
 * `gh api graphql` output for `buildPrQuery` -> each PR it could read. A PR
 * GitHub could not resolve comes back null next to the others, and is absent.
 */
export declare function parseGhPrGraphql(json: string): Map<number, Omit<ShippedPr, 'number'>>;
/** Look several PRs up at once. Injectable so tests never touch gh. */
export interface PrBatchLookup {
    (repo: string, numbers: number[]): Promise<Map<number, Omit<ShippedPr, 'number'>>>;
}
/**
 * The batched lookup: one `gh api graphql` call per 50 PRs, all at once. A
 * repo with 150 PRs costs three round trips instead of 150 `gh pr view`s.
 * A PR that cannot be read is absent; a failed call costs only its batch.
 */
export declare const ghPrLookupMany: PrBatchLookup;
/** The real lookup: `gh pr view`. Returns null on any failure. */
export declare const ghPrLookup: PrLookup;
/**
 * Look every PR up at once, keeping the order asked for. A PR that cannot be
 * read is dropped rather than guessed at.
 */
export declare function shippedPrs(repo: string, numbers: number[], lookup?: PrLookup): Promise<ShippedPr[]>;
/**
 * Contributor key -> Slack user id, one entry per distinct person.
 *
 * Keyed by `contributorKey` because most contributors come from commits and
 * have no login at all. Order of trust: a hand-configured override first —
 * by login, then by key, since the key is the only handle a commit-only
 * contributor has — then each known email in turn. Anyone nobody can be found
 * for maps to null, and the message then names them in plain text.
 */
export declare function resolveMentions(contributors: Contributor[], deps: {
    token: string | null;
    lookup: (token: string, email: string) => Promise<string | null>;
    override: (key: string) => string | null;
}): Promise<Record<string, string | null>>;
//# sourceMappingURL=shipped.d.ts.map