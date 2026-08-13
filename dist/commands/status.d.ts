/**
 * Status Command
 *
 * Read-only. Reports, per repo, what is deployed to staging and production and
 * how far apart the long-lived branches have drifted — replacing the
 * checkout-pull-look loop.
 */
import { Command } from 'commander';
import { type RepoConfig } from '../config/repos.js';
export declare function repoDir(repo: RepoConfig, override?: string): string | null;
export declare function registerStatusCommand(program: Command): void;
//# sourceMappingURL=status.d.ts.map