/**
 * Per-user configuration: which repo lives where.
 *
 * A resolved name→path map rather than a single workspace root, because
 * teammates keep Vast repos in scattered locations rather than under one
 * parent.
 */
import type { RepoConfig } from './repos.js';
export interface VastConfig {
    /** Canonical repo name -> absolute path of the checkout. */
    repos: Record<string, string>;
    /** Directories discovery has previously found repos in. */
    searchRoots: string[];
    discoveredAt?: string;
}
/** Shared with production-lock.ts so tests can sandbox both at once. */
export declare function vastHome(): string;
export declare function configPath(): string;
export declare function readConfig(): VastConfig;
export declare function writeConfig(config: VastConfig): void;
export declare function setRepoPath(name: string, dir: string): void;
/** Drop an entry that no longer describes anything on this machine. */
export declare function forgetRepoPath(name: string): void;
/**
 * Remember a directory future discovery must sweep.
 *
 * `vast clone --into ~/side` puts repos somewhere no heuristic would guess, so
 * the destination has to be recorded or the next `vast init` cannot see them.
 */
export declare function addSearchRoot(dir: string): void;
export declare function cachedRepoPath(name: string): string | undefined;
/**
 * Absolute path of a repo's checkout, or null if it is not on this machine.
 *
 * Trusts the cache only when the directory still exists AND still has a
 * matching origin — a moved or repurposed clone must not become a permanent
 * dead end. On a miss it re-scans and repairs the entry for just this repo;
 * persisting that repair is the point, so later runs skip the sweep entirely.
 *
 * When the re-scan also comes up empty, the dead entry is deleted rather than
 * left to fail the same way on every future call.
 */
export declare function resolveRepoDir(name: string): string | null;
/**
 * A repo's checkout path, honouring an explicit `--dir` override.
 *
 * The one resolution entry point for commands — `status`, `promote`, `deploy`,
 * and `release` all need exactly this, and two spellings of it drifted apart
 * once already.
 */
export declare function repoDir(repo: RepoConfig, override?: string): string | null;
//# sourceMappingURL=workspace.d.ts.map