/**
 * Status Command
 *
 * Read-only. Reports, per repo, what is deployed to staging and production and
 * how far apart the long-lived branches have drifted — replacing the
 * checkout-pull-look loop.
 */
import { Command } from 'commander';
import { type DeployEnv, type RepoConfig, type ReleaseTeam } from '../config/repos.js';
export interface Row {
    name: string;
    staging: string;
    production: string;
    drift: string;
}
/**
 * The deployed tag per env, for every repo at once.
 *
 * Each env is one `gh api` call against Vast-deployments. Both run concurrently:
 * serially this is one round trip per repo per env and the command stops
 * feeling instant. A repo that is not deployed to an env reads "n/a"; a read
 * that fails reads "?", because a broken lookup is not the same claim as
 * "nothing is deployed".
 */
export type TagReader = (repo: RepoConfig, env: DeployEnv) => Promise<string>;
/** One repo's two tag cells. */
export interface RepoTags {
    staging: string;
    production: string;
}
export declare function readTags(targets: RepoConfig[], readTag?: TagReader): Promise<Map<string, RepoTags>>;
export interface StatusCell {
    tag: string | null;
    problem: string | null;
}
export interface StatusDrift {
    text: string;
    /** Commits develop has that staging lacks; null when that cannot be said. */
    ahead: number | null;
    problem: string | null;
}
export interface StatusJsonRepo {
    repo: string;
    displayName: string;
    releaseTeam: ReleaseTeam | null;
    staging: StatusCell;
    production: StatusCell;
    drift: StatusDrift;
}
export interface StatusJson {
    generatedAt: string;
    repos: StatusJsonRepo[];
}
/** The table, as data: built from the same rows, so the two cannot disagree. */
export declare function statusJson(targets: RepoConfig[], rows: Row[], generatedAt: Date): StatusJson;
export declare function registerStatusCommand(program: Command): void;
//# sourceMappingURL=status.d.ts.map