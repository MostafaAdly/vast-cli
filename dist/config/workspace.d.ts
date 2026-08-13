/**
 * Per-user configuration: which repo lives where.
 *
 * A resolved name→path map rather than a single workspace root, because
 * teammates keep Vast repos in scattered locations rather than under one
 * parent.
 */
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
export declare function cachedRepoPath(name: string): string | undefined;
/**
 * Absolute path of a repo's checkout, or null if it is not on this machine.
 *
 * Trusts the cache only when the directory still exists AND still has a
 * matching origin — a moved or repurposed clone must not become a permanent
 * dead end. On a miss it re-scans and repairs the entry for just this repo.
 */
export declare function resolveRepoDir(name: string): string | null;
//# sourceMappingURL=workspace.d.ts.map