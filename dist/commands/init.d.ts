/**
 * Init Command
 *
 * Builds the repo map by walking the filesystem, so the CLI works on any
 * machine regardless of where repos were cloned or what they were named.
 */
import { Command } from 'commander';
/** Deterministic fallback: shortest path, ties broken by sort order. */
export declare function pickShortest(candidates: string[]): string;
export declare function resolveCandidates(map: Map<string, string[]>, interactive: boolean): Promise<Record<string, string>>;
export declare function registerInitCommand(program: Command): void;
//# sourceMappingURL=init.d.ts.map