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
/**
 * Directories too broad to scan from. Walking `/` or `$HOME` at depth 4 sweeps
 * an entire machine, so the current directory is only added as a search root
 * when it is somewhere specific.
 */
export declare function isTooBroadToScan(dir: string): boolean;
/**
 * The roots a scan starts from, before the current directory and any --root.
 *
 * The defaults are ALWAYS included. Previously, once a scan had saved any roots
 * those replaced the defaults entirely — so cloning a repo into a normal place
 * like ~/projects went unnoticed by a plain `vast init`, and the only cure was a
 * flag the user had no reason to suspect they needed.
 *
 * `--rescan` drops the saved roots, which is how you forget locations you have
 * moved away from. It cannot drop the defaults; nothing should.
 */
export declare function baseRoots(saved: string[], rescan: boolean): string[];
/**
 * Search roots for a scan, given extra roots the user named and where they are
 * standing.
 *
 * The current directory is included because `cd` into your repos and run
 * `vast init` is what people actually try — and without it the command ignores
 * where you are entirely, which reads as "it found nothing and I don't know
 * why". Explicit --root paths are always honoured, even broad ones: asking for
 * a directory by name is a deliberate act.
 */
export declare function rootsFor(extra: string[], cwd: string, base: string[]): string[];
//# sourceMappingURL=discover.d.ts.map