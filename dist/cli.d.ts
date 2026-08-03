/**
 * Main CLI Entry Point
 *
 * Bootstraps the Vast CLI application, registers all commands,
 * and handles global error handling and help text.
 */
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
     * Display custom banner/help
     */
    private displayBanner;
    /**
     * Run the CLI
     */
    run(): Promise<void>;
}
//# sourceMappingURL=cli.d.ts.map