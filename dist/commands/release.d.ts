/**
 * Release Command
 *
 * The whole staging ritual in one line: promote develop → staging, derive the
 * next release candidate from the deployed Helm tag, dispatch the workflow,
 * wait for it, and merge the version-bump PR.
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
 * Repos `vast release` acts on. `--all` is filtered to releasable repos, so an
 * unreleasable repo (no workflow / no Helm) that simply is not cloned yet
 * cannot fail the whole sweep with a spurious "not cloned".
 */
export declare function releaseTargets(repoName: string | undefined, all: boolean): RepoConfig[];
export declare function registerReleaseCommand(program: Command): void;
//# sourceMappingURL=release.d.ts.map