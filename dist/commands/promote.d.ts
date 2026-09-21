/**
 * Promote Command
 *
 * The merge half of the release chain: fast-forward both branches, verify the
 * merge is clean without touching the working tree, then merge and push.
 *
 * Refuses on conflict. It never attempts a resolution — a stranded half-merged
 * checkout is the exact failure this replaces.
 *
 * Production is different in kind: it opens a reviewed release/X.Y.Z pull
 * request and stops. Nothing here merges it, and it is gated on the production
 * lock being lifted.
 */
import { Command } from 'commander';
import { type RepoConfig } from '../config/repos.js';
import { type ReleaseKind } from '../utils/release-branch.js';
import { type ResolvedPick } from '../utils/picks.js';
import { type BodyMode } from '../utils/changelog.js';
import { buildReleaseMessage, type ShippedPr } from '../utils/release-message.js';
/**
 * Everything the announcement reaches outside itself, in one injectable bag —
 * so the announce step can be tested end to end without a network, a Slack
 * workspace, or an authenticated gh.
 */
export interface AnnounceDeps {
    readSlackToken: () => string | null;
    readSlackChannel: () => string | null;
    slackUserOverride: (login: string) => string | null;
    lookupUserByEmail: (token: string, email: string) => Promise<string | null>;
    postMessage: (token: string, channel: string, text: string) => Promise<{
        ts: string;
        channel: string;
    }>;
    shippedPrs: (repo: string, numbers: number[]) => Promise<ShippedPr[]>;
    buildReleaseMessage: typeof buildReleaseMessage;
}
/**
 * Tell the team a release PR is open.
 *
 * Runs only AFTER the PR exists, and never fails the promotion: by this point
 * the branch is pushed and the PR is open, so a missing token or an unreachable
 * Slack costs the announcement and nothing else. Every path that cannot post
 * prints the message instead, so the operator can paste it by hand.
 */
export declare function announceRelease(repo: RepoConfig, dir: string, kind: ReleaseKind, version: string, url: string | null, opts: {
    dryRun: boolean;
    picks?: ResolvedPick[];
}, deps?: AnnounceDeps): Promise<void>;
/**
 * @returns true when the promotion completed (or would have, under dryRun).
 *
 * Async because a production promotion derives its version from the live tag,
 * read over the API from Vast-deployments — or, while production is not
 * migrated, from the app repo's own Helm on `origin/production`.
 */
export declare function promote(repo: RepoConfig, dir: string, to: 'staging' | 'production', dryRun: boolean, kind?: ReleaseKind, targetVersion?: string, bodyMode?: BodyMode, pickRefs?: string[], slack?: boolean): Promise<boolean>;
export declare function registerPromoteCommand(program: Command): void;
//# sourceMappingURL=promote.d.ts.map