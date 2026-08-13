/**
 * Main CLI Entry Point
 *
 * Bootstraps the Vast CLI application, registers all commands,
 * and handles global error handling and help text.
 */
/**
 * CLI version, generated from package.json by scripts/sync-version.mjs.
 *
 * Never hardcode it here again: `npm version` only touches package.json, so a
 * literal silently drifts. v1.1.0 shipped reporting 1.0.0, which made the
 * update check tell every user they were permanently out of date.
 */
export { VERSION } from './version.js';
export declare class VastCli {
    private program;
    constructor();
    /**
     * Configure the base CLI program
     */
    private configure;
    /**
     * Register all available commands.
     *
     * Every command registered here appears in `vast --help`. Ordered by the
     * everyday release flow rather than alphabetically: look, promote, ship.
     */
    private registerCommands;
    /**
     * Show a cached update hint, and detach a refresh if one is due.
     *
     * Both halves are free. The hint is read from a local file, and the refresh
     * runs in a detached child that this process does not wait on — so a slow or
     * unreachable GitHub cannot add a millisecond to any command. It also runs
     * BEFORE the command rather than after, because most commands end in
     * process.exit() and anything after would never execute.
     */
    private maybeCheckForUpdates;
    /**
     * Run the CLI
     */
    run(): Promise<void>;
}
//# sourceMappingURL=cli.d.ts.map