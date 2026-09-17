/**
 * Status Command
 *
 * Read-only. Reports, per repo, what is deployed to staging and production and
 * how far apart the long-lived branches have drifted — replacing the
 * checkout-pull-look loop.
 */
import { Command } from 'commander';
import { type DeployEnv, type RepoConfig } from '../config/repos.js';
import { type ProductionTagSource } from '../utils/deployments.js';
/**
 * The deployed tag per env, for every repo at once.
 *
 * Staging is one `gh api` call against Vast-deployments; production may fall
 * back to the app repo's Helm while it is unmigrated. Both run concurrently:
 * serially this is one round trip per repo per env and the command stops
 * feeling instant. A repo that is not deployed to an env reads "n/a"; a read
 * that fails reads "?", because a broken lookup is not the same claim as
 * "nothing is deployed".
 */
export type TagReader = (repo: RepoConfig, env: DeployEnv) => Promise<string>;
/** Production's reader is separate: it may answer from the app repo (see deployments.ts). */
export type ProductionTagReader = (repo: RepoConfig, dir: string | null) => Promise<ProductionTagSource>;
/** One repo's two tag cells, plus where production's came from. */
export interface RepoTags {
    staging: string;
    production: string;
    productionFromAppRepo: boolean;
}
/**
 * @param dirs each target's resolved checkout path, shared with refreshAll —
 * production's reader needs it for the pre-migration Helm fallback, and
 * resolving a path is expensive enough that it happens once per repo.
 */
export declare function readTags(targets: RepoConfig[], dirs?: Map<string, string | null>, readStaging?: TagReader, readProduction?: ProductionTagReader): Promise<Map<string, RepoTags>>;
export declare function registerStatusCommand(program: Command): void;
//# sourceMappingURL=status.d.ts.map