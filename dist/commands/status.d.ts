/**
 * Status Command
 *
 * Read-only. Reports, per repo, what is deployed to staging and production and
 * how far apart the long-lived branches have drifted — replacing the
 * checkout-pull-look loop.
 */
import { Command } from 'commander';
import { type DeployEnv, type RepoConfig } from '../config/repos.js';
/**
 * The deployed tag per env, for every repo at once.
 *
 * Each read is one `gh api` call against Vast-deployments — the app checkouts
 * no longer carry the answer — so they run concurrently: serially this is one
 * round trip per repo per env and the command stops feeling instant. A repo
 * that is not deployed to an env reads "n/a"; a read that fails reads "?",
 * because a broken lookup is not the same claim as "nothing is deployed".
 */
export type TagReader = (repo: RepoConfig, env: DeployEnv) => Promise<string>;
export declare function readTags(targets: RepoConfig[], read?: TagReader): Promise<Map<string, Record<DeployEnv, string>>>;
export declare function registerStatusCommand(program: Command): void;
//# sourceMappingURL=status.d.ts.map