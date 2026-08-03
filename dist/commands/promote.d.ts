/**
 * Promote Command
 *
 * The merge half of the release chain: fast-forward both branches, verify the
 * merge is clean without touching the working tree, then merge and push.
 *
 * Refuses on conflict. It never attempts a resolution — a stranded half-merged
 * checkout is the exact failure this replaces.
 *
 * Production is different in kind: it opens a reviewed release/X.Y.Z pull
 * request and stops. Nothing here merges it, and it is gated on the production
 * lock being lifted.
 */
import { Command } from 'commander';
import { type RepoConfig } from '../config/repos.js';
export declare function defaultRepoDir(repo: RepoConfig): string;
/** @returns true when the promotion completed (or would have, under dryRun). */
export declare function promote(repo: RepoConfig, dir: string, to: 'staging' | 'production', dryRun: boolean): boolean;
export declare function registerPromoteCommand(program: Command): void;
//# sourceMappingURL=promote.d.ts.map