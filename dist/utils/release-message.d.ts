/**
 * The one-line Slack announcement for a release.
 *
 * The shape is the team's, not this tool's — it is what they already post by
 * hand:
 *
 *   • <pr|App - release/2.1.25> - What changed (@author) (<clickup|VA-12755>)
 *
 * Everything here is pure: it is handed the PRs and the resolved mentions and
 * returns a string. Nothing in this file talks to GitHub, Slack or git, which
 * is why the exact wording can be pinned in tests.
 */
export interface ShippedPr {
    number: number;
    title: string;
    url: string;
    authorLogin: string;
    authorName: string;
    authorEmails: string[];
    branch: string;
}
export interface ReleaseMessageInput {
    /** The human name of the app, e.g. "Vastmenu Dashboard". */
    displayName: string;
    branch: string;
    /** The release PR. May be a placeholder on a dry run. */
    prUrl: string;
    prs: ShippedPr[];
    /** Commit subjects, used only when no PRs could be found. */
    fallbackSubjects: string[];
    /** GitHub login -> Slack member id, or null when nobody matched. */
    mentions: Record<string, string | null>;
}
export declare function extractTickets(texts: string[]): string[];
/**
 * What shipped, in one phrase.
 *
 * PR titles come first because they were written to be read by the team; the
 * conventional-commit prefix is dropped because "feat(dashboard):" is noise in
 * a sentence. A change that appears twice — the same fix opened against two
 * branches, say — is named once.
 */
export declare function describe(prs: ShippedPr[], fallbackSubjects: string[]): string;
export declare function buildReleaseMessage(input: ReleaseMessageInput): string;
//# sourceMappingURL=release-message.d.ts.map