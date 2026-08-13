/**
 * Init Command
 *
 * Builds the repo map by walking the filesystem, so the CLI works on any
 * machine regardless of where repos were cloned or what they were named.
 */
import { Command } from 'commander';
/**
 * Fold this scan's results into what was already known.
 *
 * A scan sees only `searchRoots`, so replacing the map wholesale deletes every
 * repo that lives outside them — `vast clone --into ~/side` followed by a plain
 * `vast init` used to lose the lot. Discovery wins for what it found; anything
 * it did not find survives only if that path still exists AND still resolves to
 * that repo, so genuinely stale entries are still cleared out.
 */
export declare function mergeRepos(existing: Record<string, string>, discovered: Record<string, string>): Record<string, string>;
export declare function resolveCandidates(map: Map<string, string[]>, interactive: boolean): Promise<Record<string, string>>;
export declare function registerInitCommand(program: Command): void;
//# sourceMappingURL=init.d.ts.map