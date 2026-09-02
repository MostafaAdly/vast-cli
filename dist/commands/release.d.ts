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
export declare function registerReleaseCommand(program: Command): void;
//# sourceMappingURL=release.d.ts.map