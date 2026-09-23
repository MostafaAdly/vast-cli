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
import { type PrLookup } from '../utils/shipped.js';
import { type OpenReleasePr } from '../utils/pending-report.js';
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
type ReleaseHead = Omit<OpenReleasePr, 'prNumbers'>;
/** Everything that touches the world, so the whole command runs in tests. */
export interface PendingDeps {
    repoDir: (repo: RepoConfig, override?: string) => string | null;
    isCheckout: (dir: string) => boolean;
    fetchBranches: (dir: string, branches: string[]) => Promise<boolean>;
    compareBranches: (dir: string, source: string, target: string) => Parity;
    prNumbersInRange: (dir: string, base: string, head: string) => number[];
    lookupPr: PrLookup;
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
    out: (text: string) => void;
    err: (text: string) => void;
}
export declare function parseOpenReleasePrs(json: string): ReleaseHead[];
export declare const defaultPendingDeps: PendingDeps;
export declare function runPending(names: string[], opts: PendingOptions, deps?: PendingDeps): Promise<number>;
export declare function registerPendingCommand(program: Command): void;
export {};
//# sourceMappingURL=pending.d.ts.map