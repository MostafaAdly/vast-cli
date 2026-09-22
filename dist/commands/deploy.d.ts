/**
 * Deploy Command
 *
 * Dispatches a version to an environment and follows it all the way to the
 * cluster.
 *
 * Staging is GitOps now: `build-deploy` builds the image and commits the tag
 * into Vast-deployments, ArgoCD notices and rolls it out. There is no bump PR
 * to merge any more — merging one was the old definition of "released", and
 * after the migration it would have meant merging into a file nothing watches.
 * So a deploy is only finished when ArgoCD reports the new tag Synced/Healthy.
 *
 * Production is the same code and the same shape, but its workflow inputs and
 * folder names are unverified assumptions, so it is refused outright (see
 * `production-lock.ts`).
 */
import { Command } from 'commander';
import { type DeployEnv, type RepoConfig } from '../config/repos.js';
import { getApplication, refreshApplication, waitForRollout, type RolloutTiming } from '../utils/argocd.js';
import { getRunStatus, runWorkflow } from '../utils/github.js';
import { type PollTiming } from '../utils/run-poll.js';
import { type StatusBoard } from '../utils/status-board.js';
export interface DeployOutcome {
    repo: string;
    version: string;
    status: 'released' | 'skipped' | 'failed';
    detail: string;
}
/**
 * The flags that mean "a whole release train" rather than named repos.
 *
 * `--all` is both trains; `--frontend` and `--backend` are one each, and may be
 * combined. `deploy` and `release` share the shape so the two commands cannot
 * drift apart on what `--frontend` means.
 */
export interface Sweep {
    all: boolean;
    frontend: boolean;
    backend: boolean;
}
export declare function isSweep(s: Sweep): boolean;
/** Repos a sweep or a list of names resolves to, deduplicated, in order. */
export declare function sweepTargets(names: string[], sweep: Sweep): {
    repos: RepoConfig[];
    unknown: string[];
};
/**
 * Repos `vast deploy` acts on. `--all` is every repo on a release train, so an
 * unreleasable repo (no workflow / no deployments file) can never fail a sweep
 * the user was not asking about; a repo named explicitly is never filtered, so
 * `vast deploy Terraform` still says "no deploy workflow" rather than "unknown
 * repository".
 */
export declare function deployTargets(names: string[], sweep: Sweep): {
    repos: RepoConfig[];
    unknown: string[];
};
/** Naming repos and sweeping a train at the same time cannot mean anything. */
export declare function sweepAndNamesProblem(names: string[], sweep: Sweep): string | null;
/**
 * The options that name exactly one thing, refused when more than one repo is
 * in play. A repo named twice is still one repo, so the count is of distinct
 * names — matching how the targets dedupe, casing and all.
 */
export declare function perRepoOptionProblem(names: string[], options: Sweep & {
    targetVersion?: string;
    dir?: string;
}): string | null;
export declare function validateDeployOptions(names: string[], options: Sweep & {
    targetVersion?: string;
    dir?: string;
}): string | null;
/**
 * The outcome for a repo that is not on this machine.
 *
 * Not being cloned is a normal state on a portable CLI — a frontend teammate
 * has no backend checkouts — so a sweep skips it. Naming that repo explicitly
 * is different: the user asked for something specific they do not have, and
 * that IS an error.
 */
export declare function notClonedOutcome(repo: string, all: boolean): DeployOutcome;
/**
 * The human gate, asked directly: was the PR for THIS version merged?
 *
 * The old check — "production contains everything staging has" — was a proxy
 * that a selective (--pick) promotion makes permanently false, because leaving
 * things out is the point. Checking that release/<v> or hotfix/<v> is an
 * ancestor of origin/production verifies exactly what matters for BOTH flows:
 * a human reviewed and merged this version's PR.
 */
export declare function verifyReleaseMerged(dir: string, version: string): Promise<{
    ok: boolean;
    detail: string;
}>;
/**
 * The version to deploy to `env`, given the tag currently on staging.
 *
 * Production ships what has been baking in staging, with the candidate suffix
 * dropped: staging 2.1.0-rc45 -> production 2.1.0.
 */
export declare function versionFor(env: DeployEnv, stagingTag: string): string;
export declare function confirmProduction(repo: string, version: string): Promise<boolean>;
/** The one line of the board a repo owns, and how wide its name is padded. */
export interface DeploySlot {
    board: StatusBoard;
    row: number;
    labelWidth: number;
}
/** Everything `deployOne` reaches the outside world with, so a test can hand it fakes. */
export interface DeployDeps {
    runWorkflow: typeof runWorkflow;
    getRunStatus: typeof getRunStatus;
    failedStepName: (repo: string, runId: number) => Promise<string | null>;
    waitForRollout: typeof waitForRollout;
    getApplication: typeof getApplication;
    refreshApplication: typeof refreshApplication;
    readArgocdToken: (env: DeployEnv) => string | null;
    /** The user-pasted load-balancer cookie that gets past the SSO wall, if any. */
    readAlbCookie: (env: DeployEnv) => string | null;
    /** `vast argocd disable` turns every ArgoCD call off for that env. */
    argocdEnabled: (env: DeployEnv) => boolean;
    argocdHost: (env: DeployEnv) => string;
    argocdAppUrl: (env: DeployEnv, app: string) => string;
    /** Overridden only by tests that exercise the real waiter. */
    rolloutTiming?: RolloutTiming;
}
export declare const DEFAULT_DEPLOY_DEPS: DeployDeps;
/**
 * One repo, dispatch to rollout, reported on one line of the board.
 *
 * Nothing here may print directly: on a TTY the board tracks the cursor by
 * counting its own lines, so one stray `console.log` scrolls the rows out from
 * under it and every later update lands on the wrong line. That is also why the
 * dispatch is quiet — the spinner would do exactly that.
 */
export declare function deployOne(repo: RepoConfig, env: DeployEnv, version: string, dryRun: boolean, slot: DeploySlot, timing?: PollTiming, deps?: DeployDeps): Promise<DeployOutcome>;
export declare function printSummary(outcomes: DeployOutcome[], env: string): void;
/**
 * How often to ask GitHub for each run's status, given how many are being
 * watched. One second per run keeps a big sweep from hammering the API with one
 * request per run every five seconds, and the floor keeps the common two- or
 * three-repo deploy as responsive as a single one.
 */
export declare function pollIntervalFor(runCount: number): number;
/**
 * The polling timing for a whole watch, live or piped.
 *
 * When the board is live each repo owns one line that is rewritten in place, so
 * a heartbeat on every poll costs no scrollback and keeps the elapsed time on
 * every line moving. Piped output appends instead, so it keeps the slow default
 * heartbeat rather than one line per repo every few seconds.
 */
export declare function pollTimingFor(runCount: number, live: boolean): PollTiming;
/** A repo that cleared every gate and has a version: ready to dispatch. */
export interface Deployable {
    repo: RepoConfig;
    version: string;
}
export declare function isOutcome(x: Deployable | DeployOutcome): x is DeployOutcome;
/** The pieces of a multi-repo deploy a test replaces; production code passes none. */
export interface DeployManyDeps {
    /** The per-repo deploy, so `release` can share this orchestration and fake it. */
    deploy?: (repo: RepoConfig, env: DeployEnv, version: string, dryRun: boolean, slot: DeploySlot, timing: PollTiming) => Promise<DeployOutcome>;
    board?: (rows: number) => StatusBoard;
}
/**
 * Several repos at once, each on its own line of one shared board.
 *
 * One board for every repo: two would each believe they own the cursor.
 * allSettled rather than all, so one repo's watch throwing cannot swallow the
 * outcomes of the repos that finished fine — that is the whole promise of the
 * multi-repo path, so it is structural here rather than a matter of every
 * caller downstream remembering to catch. Outcomes come back in the order the
 * repos were given, so the summary reads the way the command was typed.
 */
export declare function deployMany(planned: Array<Deployable | DeployOutcome>, env: DeployEnv, dryRun: boolean, deps?: DeployManyDeps): Promise<DeployOutcome[]>;
export declare function registerDeployCommand(program: Command): void;
//# sourceMappingURL=deploy.d.ts.map