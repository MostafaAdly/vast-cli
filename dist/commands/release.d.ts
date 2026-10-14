/**
 * Release Command
 *
 * The whole staging ritual in one line: promote develop → staging, derive the
 * next release candidate from the tag Vast-deployments says is live, dispatch
 * the repo's "<Repo> Pipeline" workflow (build-deploy.yml), watch the run, and
 * watch ArgoCD until the new tag is actually running. There is no version-bump PR any more — staging is GitOps.
 *
 * Several repos at once behave like one terminal per repo: each is promoted in
 * turn — seconds of local git — and then every deploy runs concurrently, so the
 * whole thing takes about one build rather than one per repo. Every repo is
 * checked before any is touched, and one that is refused stops the whole
 * release before anything is promoted or deployed. A repo with nothing to
 * deploy (not cloned in a sweep, no workflow) is skipped, not refused.
 *
 * Staging only. Production has a human review gate in the middle, so it is two
 * commands (promote, then deploy) rather than one — and its deploy is blocked
 * outright until DevOps has migrated it.
 */
import { Command } from 'commander';
import { type RepoConfig } from '../config/repos.js';
import type { ReadProduction } from '../utils/version-guard.js';
import { isSweep, pollIntervalFor, pollTimingFor, type Deployable, type DeployManyDeps, type DeployOutcome, type Sweep } from './deploy.js';
import { type EventSink, type VastEvent } from '../utils/events.js';
import { type PromotionReport } from '../utils/promotion-report.js';
export { isSweep, pollIntervalFor, pollTimingFor, type Deployable, type Sweep };
export interface ReleaseOptions {
    to: string;
    dir?: string;
    dryRun: boolean;
    targetVersion?: string;
    /** Start a new version series instead of continuing the current rc run. */
    bump?: 'patch' | 'minor' | 'major';
    /** Replace a version that is not above production's with the first one that is. */
    fixVersion?: boolean;
    skipPromote: boolean;
    all: boolean;
    frontend: boolean;
    backend: boolean;
    json?: boolean;
}
/**
 * Whether this repo has a develop branch to promote into staging.
 *
 * `vast promote <repo>` (explicit) still refuses when this is false — an
 * explicit ask to merge develop deserves an explanation, not a silent no-op.
 * Only `vast release` treats it as a skip.
 */
export declare function needsPromotion(repo: RepoConfig): boolean;
/**
 * Option combinations that cannot mean anything, refused before any repo is
 * touched — never after the first repo has already been released.
 */
export declare function validateReleaseOptions(names: string[], options: Sweep & {
    targetVersion?: string;
    dir?: string;
    bump?: string;
    fixVersion?: boolean;
}): string | null;
/**
 * Repos `vast release` acts on, in the order they were named, deduplicated.
 *
 * A sweep releases whole trains, declared per repo in the config rather than
 * derived here: a repo outside both trains (vast-menu-payments) and an
 * unreleasable one (Terraform, Vast-Finance, vastpay-payment-odoo) are simply
 * never swept, so a sweep can never fail on a repo the user was not asking
 * about. `--all` is the frontend train then the backend one; naming the trains
 * individually keeps that same order. Named repos are never filtered: an
 * explicit `vast release Terraform` deserves "no deploy workflow", not
 * "unknown repository".
 */
export declare function releaseTargets(names: string[], sweep: Sweep): {
    repos: RepoConfig[];
    unknown: string[];
};
/** The network and git calls in `prepareOne`, injectable so tests never touch either. */
export interface PrepareDeps {
    stagingTag?: (repo: RepoConfig) => Promise<string>;
    promote?: (repo: RepoConfig, dir: string, dryRun: boolean, report: PromotionReport) => Promise<boolean>;
    readProduction?: ReadProduction;
}
/**
 * Everything before the deploy that changes nothing: resolve the checkout,
 * derive the version, check it against production. Returns an outcome instead
 * when the repo cannot go further.
 *
 * Async because the deployed tag comes from Vast-deployments over the API, not
 * from a file in the local checkout.
 */
export declare function checkOne(repo: RepoConfig, options: ReleaseOptions, deps?: PrepareDeps): Promise<Deployable | DeployOutcome>;
/**
 * Promote develop into staging for a repo that passed its check. `dryRun` is
 * its own argument, not the option: a multi-repo release runs it as a trial
 * (fetch and trial merge, nothing pushed) before promoting anything for real.
 */
export declare function promoteOne(planned: Deployable, options: ReleaseOptions, dryRun: boolean, deps?: PrepareDeps): Promise<Deployable | DeployOutcome>;
/** One repo, checked then promoted: what a single-repo release does before deploying. */
export declare function prepareOne(repo: RepoConfig, options: ReleaseOptions, deps?: PrepareDeps): Promise<Deployable | DeployOutcome>;
/** One repo's preparation, as the app's preview reads it. */
export declare function planEvent(repo: RepoConfig, prepared: Deployable | DeployOutcome): VastEvent;
/** The parts of a release, injectable so they can be faked in tests. */
export interface ReleaseManyDeps extends DeployManyDeps {
    check?: (repo: RepoConfig, options: ReleaseOptions) => Promise<Deployable | DeployOutcome>;
    promote?: (planned: Deployable, options: ReleaseOptions, dryRun: boolean) => Promise<Deployable | DeployOutcome>;
}
/**
 * Every repo, like one terminal per repo, and all or nothing.
 *
 * 1. Check every repo before touching any: checkout, version, the production
 *    guard and, when more than one repo is named, a trial promotion (fetch and
 *    trial merge, nothing pushed). A dry run's promotion is this trial.
 * 2. If any repo cannot go ahead, stop: nothing is promoted or deployed. A
 *    release of three repos that quietly ships two is the surprise this
 *    prevents; the refusal is printed the moment it is found.
 * 3. Promote each for real, in turn (seconds of local git). A promotion that
 *    fails here (a push rejected since the trial) stops the deploys too.
 * 4. Deploy them all concurrently on one shared board (minutes of CI and ArgoCD).
 *
 * One repo takes the same path with a single-row board: a second code path for
 * the common case is a second place for the ArgoCD wait to be forgotten.
 */
export declare function releaseMany(targets: RepoConfig[], options: ReleaseOptions, deps?: ReleaseManyDeps): Promise<DeployOutcome[]>;
/**
 * The whole release, as an exit code rather than a process.exit, so it can be
 * driven by --json and by tests. Every human line still prints; in --json mode
 * the command boundary has already moved those lines to stderr.
 */
export declare function runRelease(repoNames: string[], options: ReleaseOptions, events: EventSink, args: string[], deps?: ReleaseManyDeps): Promise<number>;
export declare function registerReleaseCommand(program: Command): void;
//# sourceMappingURL=release.d.ts.map