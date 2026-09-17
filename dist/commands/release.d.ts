/**
 * Release Command
 *
 * The whole staging ritual in one line: promote develop → staging, derive the
 * next release candidate from the tag Vast-deployments says is live, dispatch
 * build-deploy, watch the run, and watch ArgoCD until the new tag is actually
 * running. There is no version-bump PR any more — staging is GitOps.
 *
 * Several repos at once behave like one terminal per repo: each is promoted in
 * turn — seconds of local git — and then every deploy runs concurrently, so the
 * whole thing takes about one build rather than one per repo. One repo refusing
 * never stops another.
 *
 * Staging only. Production has a human review gate in the middle, so it is two
 * commands (promote, then deploy) rather than one — and its deploy is blocked
 * outright until DevOps has migrated it.
 */
import { Command } from 'commander';
import { type RepoConfig } from '../config/repos.js';
import { isSweep, pollIntervalFor, pollTimingFor, type Deployable, type DeployManyDeps, type DeployOutcome, type Sweep } from './deploy.js';
export { isSweep, pollIntervalFor, pollTimingFor, type Deployable, type Sweep };
export interface ReleaseOptions {
    to: string;
    dir?: string;
    dryRun: boolean;
    targetVersion?: string;
    /** Start a new version series instead of continuing the current rc run. */
    bump?: 'patch' | 'minor' | 'major';
    skipPromote: boolean;
    all: boolean;
    frontend: boolean;
    backend: boolean;
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
/**
 * Everything before the deploy: resolve the checkout, promote, derive the
 * version. Returns an outcome instead when the repo cannot go further.
 *
 * Async because the deployed tag now comes from Vast-deployments over the API,
 * not from a file in the local checkout.
 */
export declare function prepareOne(repo: RepoConfig, options: ReleaseOptions): Promise<Deployable | DeployOutcome>;
/** The two halves of a release, injectable so they can be faked in tests. */
export interface ReleaseManyDeps extends DeployManyDeps {
    prepare?: (repo: RepoConfig, options: ReleaseOptions) => Promise<Deployable | DeployOutcome>;
}
/**
 * Every repo, like one terminal per repo. Promote and derive each in turn
 * (seconds of local git), then deploy them all concurrently on one shared
 * board (minutes of CI and ArgoCD).
 *
 * One repo takes the same path with a single-row board: a second code path for
 * the common case is a second place for the ArgoCD wait to be forgotten.
 */
export declare function releaseMany(targets: RepoConfig[], options: ReleaseOptions, deps?: ReleaseManyDeps): Promise<DeployOutcome[]>;
export declare function registerReleaseCommand(program: Command): void;
//# sourceMappingURL=release.d.ts.map