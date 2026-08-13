/**
 * Clone Command
 *
 * Gets a new teammate from nothing to a working checkout set in one command.
 * Clones through `gh`, so authentication and the user's preferred protocol come
 * for free — and everyone using this CLI already has `gh` authenticated.
 */
import { Command } from 'commander';
/** The directory most of the known checkouts already sit in. */
export declare function commonParent(paths: string[]): string | null;
export declare function registerCloneCommand(program: Command): void;
//# sourceMappingURL=clone.d.ts.map