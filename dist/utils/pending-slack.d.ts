/**
 * The pending list as one Slack message: a bold heading, then one bullet per
 * repo in the team's announcement shape, linking GitHub's compare view.
 * Only what the target still lacks is posted — the reverse direction is a
 * question for whoever runs the report, not news for the channel.
 */
import { type PendingReport } from './pending-report.js';
import { type Contributor } from './contributors.js';
/** Everyone behind the forward list, once each — the people the post may mention. */
export declare function pendingContributors(report: PendingReport): Contributor[];
export declare function buildPendingSlack(report: PendingReport, mentions: Record<string, string | null>): {
    text: string;
    blocks: unknown[];
} | null;
//# sourceMappingURL=pending-slack.d.ts.map