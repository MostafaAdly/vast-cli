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