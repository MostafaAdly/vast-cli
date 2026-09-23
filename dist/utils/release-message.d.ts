/**
 * The one-line Slack announcement for a release.
 *
 * The shape is the team's, not this tool's — it is the post they already write
 * by hand, as one Slack bullet:
 *
 *   • <pr|App - hotfix/2.1.15> - ELM single charge, Apple Pay layout (@Mostafa Adly, @Osama Elshimy) (VA-13091, VA-13085)
 *
 * It is produced twice: as `text`, the mrkdwn line Slack shows in the
 * notification and in any client that cannot draw blocks, and as `blocks`, a
 * rich_text list so the channel sees a real bullet with real mentions rather
 * than a typed "•".
 *
 * Everything here is pure: it is handed the PRs, their summaries and the
 * resolved mentions and returns the message. Nothing in this file talks to
 * GitHub, Slack, git or a model, which is why the exact wording can be pinned in
 * tests.
 */
import type { ShippedPr } from './shipped.js';
import { type Contributor } from './contributors.js';
export interface ReleaseMessageInput {
    /** The human name of the app, e.g. "Vastpay Pwa V2". */
    displayName: string;
    branch: string;
    /** The release PR. May be a placeholder on a dry run. */
    prUrl: string;
    prs: ShippedPr[];
    /** PR number -> a two-or-three word summary of that PR. */
    summaries: Record<number, string>;
    /** Commit subjects, used only when no PRs could be found. */
    fallbackSubjects: string[];
    /** contributorKey -> Slack member id, or null when nobody matched. */
    mentions: Record<string, string | null>;
}
export interface ReleaseMessage {
    /** mrkdwn fallback: the notification preview, and what is printed on a dry run. */
    text: string;
    /** The rich_text bullet Slack actually renders. */
    blocks: unknown[];
}
export declare function extractTickets(texts: string[]): string[];
/**
 * What shipped, in one phrase.
 *
 * Each PR contributes its summary, falling back to its tidied title when no
 * summary came back. Only when there are no PRs at all do commit subjects stand
 * in. A change that appears twice — the same fix opened against two branches,
 * say — is named once.
 */
export declare function describe(prs: ShippedPr[], summaries: Record<number, string>, fallbackSubjects: string[]): string;
/** Everyone who worked on the release — authors and committers — once each, in PR order. */
export declare function releaseContributors(prs: ShippedPr[]): Contributor[];
export declare function buildReleaseMessage(input: ReleaseMessageInput): ReleaseMessage;
//# sourceMappingURL=release-message.d.ts.map