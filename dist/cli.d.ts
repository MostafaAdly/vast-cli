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
     * Register all available commands
     * New commands are added here
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