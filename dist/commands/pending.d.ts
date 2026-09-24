/**
 * Pending Command
 *
 * Read-only. Lists what one branch has that the next one lacks — staging vs
 * production by default, develop vs staging with --to staging — by PR, not
 * by commit, and with --parity both ways. The only thing it ever writes is a
 * Slack post, and only with --slack.
 */
import { Command } from 'commander';
import type { RepoConfig } from '../config/repos.js';
import { type Parity } from '../utils/parity.js';
import { type PrBatchLookup } from '../utils/shipped.js';
import { type OpenReleasePr, type TerminalStyle } from '../utils/pending-report.js';
export interface PendingOptions {
    to: string;
    parity: boolean;
    all: boolean;
    frontend: boolean;
    backend: boolean;
    byTicket: boolean;
    short: boolean;
    markdown: boolean;
    slack: boolean;
    json: boolean;
    dir?: string;
}
type ReleaseHead = Omit<OpenReleasePr, 'prNumbers' | 'commits'>;
/** Everything that touches the world, so the whole command runs in tests. */
export interface PendingDeps {
    repoDir: (repo: RepoConfig, override?: string) => string | null;
    isCheckout: (dir: string) => boolean;
    /** One fetch of exactly these branches: true only if all of them fetched. */
    fetchBranches: (dir: string, branches: string[]) => Promise<boolean>;
    compareBranches: (dir: string, source: string, target: string) => Promise<Parity>;
    /** Which of these commits' changes `ref`'s tree already holds. */
    containedIn: (dir: string, ref: string, shas: string[]) => Promise<Set<string>>;
    prNumbersInRange: (dir: string, base: string, head: string) => number[];
    lookupPrs: PrBatchLookup;
    openReleasePrs: (repo: string) => Promise<ReleaseHead[]>;
    modelPhrases: (prs: Array<{
        number: number;
        title: string;
        branch: string;
    }>) => Promise<Record<number, string>>;
    readSlackToken: () => string | null;
    readSlackChannel: () => string | null;
    slackUserOverride: (login: string) => string | null;
    lookupUserByEmail: (token: string, email: string) => Promise<string | null>;
    postMessage: (token: string, channel: string, text: string, blocks: unknown[]) => Promise<unknown>;
    now: () => Date;
    /** Colours and links when stdout is a terminal; plain otherwise. */
    terminalStyle: () => TerminalStyle;
    out: (text: string) => void;
    err: (text: string) => void;
}
export declare function parseOpenReleasePrs(json: string): ReleaseHead[];
export declare const defaultPendingDeps: PendingDeps;
export declare function runPending(names: string[], opts: PendingOptions, deps?: PendingDeps): Promise<number>;
export declare function registerPendingCommand(program: Command): void;
export {};
//# sourceMappingURL=pending.d.ts.map