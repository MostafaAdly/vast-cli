/**
 * Release Command
 *
 * The whole staging ritual in one line: promote develop → staging, derive the
 * next release candidate from the deployed Helm tag, dispatch the workflow,
 * wait for it, and merge the version-bump PR.
 *
 * Several repos at once behave like one terminal per repo: each is promoted
 * and dispatched in turn — seconds of local git and gh — and then every CI run
 * is watched concurrently, so the whole thing takes about one build rather
 * than one per repo. One repo refusing never stops another.
 *
 * Staging only. Production has a human review gate in the middle, so it is two
 * commands (promote, then deploy) rather than one.
 */
import { Command } from 'commander';
import { type RepoConfig } from '../config/repos.js';
import { type DeployOutcome } from './deploy.js';
import { type PollTiming } from '../utils/run-poll.js';
import { type StatusBoard } from '../utils/status-board.js';
export interface ReleaseOptions {
    to: string;
    dir?: string;
    dryRun: boolean;
    targetVersion?: string;
    /** Start a new version series instead of continuing the current rc run. */
    bump?: 'patch' | 'minor' | 'major';
    skipPromote: boolean;
    all: boolean;
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
export declare function validateReleaseOptions(names: string[], options: {
    all: boolean;
    targetVersion?: string;
    dir?: string;
    bump?: string;
}): string | null;
/**
 * Repos `vast release` acts on, in the order they were named, deduplicated.
 *
 * `--all` is filtered to releasable repos, so an unreleasable repo (no
 * workflow / no Helm) that simply is not cloned yet cannot fail the whole
 * sweep with a spurious "not cloned". Named repos are never filtered: an
 * explicit `vast release Terraform` deserves "no deploy workflow", not
 * "unknown repository".
 */
export declare function releaseTargets(names: string[], all: boolean): {
    repos: RepoConfig[];
    unknown: string[];
};
/** A dispatched run the concurrent path is waiting on. */
export interface InFlight {
    repo: RepoConfig;
    version: string;
    runId: number;
}
/**
 * How often to ask GitHub for each run's status, given how many are being
 * watched. One second per run keeps a big `--all` sweep from hammering the API
 * with one request per run every five seconds, and the floor keeps the common
 * two- or three-repo release as responsive as a single one.
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
/** The one line of the board a repo owns, and how wide its name is padded. */
export interface FinishSlot {
    board: StatusBoard;
    row: number;
    labelWidth: number;
}
/** The two halves of a multi-repo release, injectable so they can be faked in tests. */
export interface ReleaseManyDeps {
    launch: (repo: RepoConfig, options: ReleaseOptions) => Promise<InFlight | DeployOutcome>;
    finish: (flight: InFlight, slot: FinishSlot, timing: PollTiming) => Promise<DeployOutcome>;
    /** Injectable so a test can record what each repo wrote to its line. */
    board?: (rows: number) => StatusBoard;
}
/**
 * Several repos, like one terminal per repo. Promote and dispatch each in turn
 * (seconds), then watch every run concurrently (minutes). Outcomes come back in
 * the order the repos were named, so the summary reads the way it was typed.
 *
 * allSettled rather than all: one repo's watch throwing must not swallow the
 * outcomes of the repos that finished fine. That is the whole promise of the
 * multi-repo path, so it is structural here rather than a matter of every
 * caller downstream remembering to catch.
 */
export declare function releaseMany(targets: RepoConfig[], options: ReleaseOptions, deps?: ReleaseManyDeps): Promise<DeployOutcome[]>;
export declare function registerReleaseCommand(program: Command): void;
//# sourceMappingURL=release.d.ts.map