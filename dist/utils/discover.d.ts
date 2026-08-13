/**
 * Finds Vast checkouts on this machine.
 *
 * Teammates keep repos in scattered locations rather than under one parent, so
 * discovery walks several likely roots and identifies each checkout by its
 * `origin` remote. Directory names are never trusted.
 */
/** Directory names, relative to $HOME, checked before sweeping wider. */
export declare const LIKELY_ROOTS: string[];
/** Never descended into. Big, and never contains a Vast checkout. */
export declare const PRUNE: Set<string>;
export declare const MAX_DEPTH = 4;
/** Absolute paths of directories that are git checkouts. */
export declare function findCheckouts(root: string, maxDepth?: number): string[];
export declare function originOf(dir: string): string | null;
/** Forget memoized sweeps — for tests that create checkouts between calls. */
export declare function clearDiscoveryCache(): void;
/**
 * @returns canonical repo name -> every checkout claiming it. More than one is
 * a real state, not an error, so all candidates are kept for the caller to
 * resolve.
 *
 * Memoized per process; call {@link clearDiscoveryCache} after creating or
 * cloning a checkout. The returned map is shared, so callers must not mutate it.
 */
export declare function discover(roots: string[]): Map<string, string[]>;
/**
 * Deterministic pick when several checkouts claim one repo: shortest path,
 * ties broken by sort order.
 *
 * Shared by `vast init`'s non-interactive fallback and the lazy repair in
 * workspace.ts, which must agree — a repair that picked differently from init
 * would silently move a repo out from under the user.
 */
export declare function pickShortest(candidates: string[]): string;
/** $HOME-relative likely roots, as absolute paths that exist. */
export declare function defaultRoots(): string[];
//# sourceMappingURL=discover.d.ts.map