/**
 * Deploy Command
 *
 * Dispatches a version to an environment and merges the resulting bump PR.
 *
 * The same GitHub Actions workflow serves both environments — build-ci-new.yaml
 * branches on GITHUB_REF to pick Dockerfile-prod vs Dockerfile-stage and the
 * matching Helm values file — so this is env-agnostic apart from the ref it
 * dispatches on, and the production lock guarding it.
 */
import { Command } from 'commander';
import { type RepoConfig } from '../config/repos.js';
export interface DeployOutcome {
    repo: string;
    version: string;
    status: 'released' | 'skipped' | 'failed';
    detail: string;
}
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
export declare function versionFor(env: 'staging' | 'production', stagingTag: string): string;
export declare function confirmProduction(repo: string, version: string): Promise<boolean>;
export declare function deployOne(repo: RepoConfig, env: 'staging' | 'production', version: string, dryRun: boolean): Promise<DeployOutcome>;
export declare function printSummary(outcomes: DeployOutcome[], env: string): void;
/**
 * Repos `vast deploy` acts on. `--all` is filtered to releasable repos, so an
 * unreleasable repo (no workflow / no Helm) that simply is not cloned yet
 * cannot fail the whole sweep with a spurious "not cloned".
 */
export declare function deployTargets(repoName: string | undefined, all: boolean): RepoConfig[];
export declare function registerDeployCommand(program: Command): void;
//# sourceMappingURL=deploy.d.ts.map