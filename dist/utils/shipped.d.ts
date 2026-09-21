/**
 * What actually shipped in a release, expressed as the PRs it carries.
 *
 * The Slack announcement is read by people who do not read commit logs, so it
 * is built from PRs and their authors rather than from raw subjects. The PR
 * numbers come out of the merge commits already in the branch — the same
 * source `skills/release/notes.sh` uses, and for the same reason: `gh search
 * commits` only indexes a repo's default branch, which here is `production`,
 * so it is blind to everything a release is made of.
 *
 * Every function here degrades rather than throws. The PR is already open by
 * the time any of this runs; a failed lookup costs the message a line, and
 * must never cost the release its announcement.
 */
import type { ResolvedPick } from './picks.js';
import type { ShippedPr } from './release-message.js';
/** How a PR number becomes the PR itself. Injectable so tests never touch gh. */
export interface PrLookup {
    (repo: string, number: number): Promise<{
        title: string;
        url: string;
        authorLogin: string;
        authorName: string;
        authorEmails: string[];
        branch: string;
    } | null>;
}
/**
 * PR numbers merged into `head` that `base` does not have.
 *
 * `--merges` matches on parent count, not on the subject, so this sees exactly
 * the real merge commits and nothing that merely looks like one.
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
/** The real lookup: `gh pr view`. Returns null on any failure. */
export declare const ghPrLookup: PrLookup;
/**
 * Look every PR up at once, keeping the order asked for. A PR that cannot be
 * read is dropped rather than guessed at.
 */
export declare function shippedPrs(repo: string, numbers: number[], lookup?: PrLookup): Promise<ShippedPr[]>;
/**
 * GitHub login -> Slack user id, one entry per distinct author.
 *
 * Order of trust: a hand-configured override first (it exists precisely for
 * the people whose git email matches nothing in Slack), then each commit email
 * in turn. A login nobody can be found for maps to null, and the message then
 * names them in plain text instead of mentioning them.
 */
export declare function resolveMentions(prs: ShippedPr[], deps: {
    token: string | null;
    lookup: (token: string, email: string) => Promise<string | null>;
    override: (login: string) => string | null;
}): Promise<Record<string, string | null>>;
//# sourceMappingURL=shipped.d.ts.map