/**
 * `vast pending`: the report model and its renderers.
 *
 * Everything here is pure — a model in, text out — so the exact output of
 * every mode is pinned in tests. Gathering the model (git, gh, the model
 * call) lives in src/commands/pending.ts.
 */
import type { Contributor } from './contributors.js';
import type { Side } from './parity.js';
export type PendingTo = 'production' | 'staging';
export interface PendingPr {
    number: number;
    /** Tidied PR title, or the branch when gh could not read the PR. */
    title: string;
    url: string;
    branch: string;
    contributors: Contributor[];
    tickets: string[];
    /** The model's 2-3 word phrase, or null when none came back. */
    phrase: string | null;
    landedAt: Date;
    /** Its code is already on the other side under another commit. */
    ported: boolean;
    detailsUnavailable: boolean;
}
export interface PendingCommit {
    sha: string;
    subject: string;
    landedAt: Date;
    ported: boolean;
    /** The open release/hotfix PR whose branch already carries this change. */
    inFlight: {
        number: number;
        branch: string;
    } | null;
}
export interface InFlightGroup {
    number: number;
    url: string;
    branch: string;
    prs: PendingPr[];
}
export interface PendingDirection {
    source: string;
    target: string;
    inFlight: InFlightGroup[];
    waiting: PendingPr[];
    direct: PendingCommit[];
}
export interface RepoProblem {
    kind: 'skipped' | 'error';
    message: string;
}
export interface RepoPending {
    repo: string;
    displayName: string;
    /** GitHub's compare view, target...source. */
    compareUrl: string;
    forward: PendingDirection | null;
    /** Only with --parity. */
    reverse: PendingDirection | null;
    problem: RepoProblem | null;
    /** Things that degraded the report without failing it. */
    notes: string[];
}
export interface PendingReport {
    to: PendingTo;
    generatedAt: Date;
    parity: boolean;
    repos: RepoPending[];
}
export interface PrDetails {
    title: string;
    url: string;
    branch: string;
    contributors: Contributor[];
}
export interface OpenReleasePr {
    number: number;
    url: string;
    branch: string;
    prNumbers: number[];
    /** SHAs of direct commits whose change its branch already carries. */
    commits: string[];
}
export interface RenderOptions {
    now: Date;
    byTicket: boolean;
    short: boolean;
}
/** Over two weeks on staging without reaching production is worth a nudge. */
export declare const STALE_DAYS = 14;
export declare function ageDays(landedAt: Date, now: Date): number;
export declare function prsOf(d: PendingDirection): PendingPr[];
export declare function buildDirection(input: {
    source: string;
    target: string;
    side: Side;
    details: Map<number, PrDetails>;
    phrases: Record<number, string>;
    openReleases: OpenReleasePr[];
    repoUrl: string;
}): PendingDirection;
/** Tickets in first-seen order, then an Untracked group; a PR with two tickets appears under both. */
export declare function groupByTicket(prs: PendingPr[]): Array<{
    ticket: string | null;
    prs: PendingPr[];
}>;
export declare function renderTerminal(report: PendingReport, o: RenderOptions): string;
/** Ready to paste into a ClickUp doc or a PR description. */
export declare function renderMarkdown(report: PendingReport, o: RenderOptions): string;
/** For the /release skill and scripts. Dates serialise as ISO strings. */
export declare function renderJson(report: PendingReport): string;
//# sourceMappingURL=pending-report.d.ts.map