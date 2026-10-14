/**
 * Main CLI Entry Point
 *
 * Bootstraps the Vast CLI application, registers all commands,
 * and handles global error handling and help text.
 */
import { Command, Help } from 'commander';
import { spawn } from 'child_process';
import { renderRootHelp } from './utils/help.js';
import { pendingHint, isDue, readState, refreshInBackground } from './utils/update-check.js';
import { registerInitCommand } from './commands/init.js';
import { registerBarCommand } from './commands/bar.js';
import { registerUpgradeCommand } from './commands/upgrade.js';
import { registerCloneCommand } from './commands/clone.js';
import { registerWorkflowCommand } from './commands/workflow.js';
import { registerStatusCommand } from './commands/status.js';
import { registerPendingCommand } from './commands/pending.js';
import { registerDoctorCommand } from './commands/doctor.js';
import { registerPromoteCommand } from './commands/promote.js';
import { registerDeployCommand } from './commands/deploy.js';
import { registerReleaseCommand } from './commands/release.js';
import { registerProductionCommand } from './commands/production.js';
import { registerArgocdCommand } from './commands/argocd.js';
import { registerSlackCommand } from './commands/slack.js';
import { colors } from './utils/ui.js';
import { reportUnexpectedError } from './utils/errors.js';
/**
 * CLI version, generated from package.json by scripts/sync-version.mjs.
 *
 * Never hardcode it here again: `npm version` only touches package.json, so a
 * literal silently drifts. v1.1.0 shipped reporting 1.0.0, which made the
 * update check tell every user they were permanently out of date.
 */
export { VERSION } from './version.js';
import { VERSION } from './version.js';
/** CLI description */
const DESCRIPTION = 'CLI toolkit for Vast-menu GitHub workflow management';
export class VastCli {
    program;
    constructor() {
        this.program = new Command();
        this.configure();
        this.registerCommands();
    }
    /**
     * Configure the base CLI program
     */
    configure() {
        this.program
            .name('vast')
            // No Commander .version(): a root-level version option is parsed anywhere
            // on the line and swallowed subcommands' own --version (`vast bar install
            // --version 2.9.0` printed the version and installed nothing). run()
            // answers `vast -V|-v|--version` itself.
            .description(DESCRIPTION)
            .helpOption('-h, --help', 'Display help for command')
            .usage('[command] [options]')
            .configureOutput({
            writeErr: (str) => process.stderr.write(str),
            writeOut: (str) => process.stdout.write(str),
        })
            // configureHelp is INHERITED by subcommands, so this must render the
            // custom screen for the root only and hand everything else back to
            // Commander's default formatter — otherwise `vast release --help` would
            // print the root screen too.
            .configureHelp({
            formatHelp: (cmd, helper) => cmd.parent === null
                ? renderRootHelp(VERSION)
                : Help.prototype.formatHelp.call(helper, cmd, helper),
        })
            .hook('preAction', (thisCommand) => {
            // Global pre-action hook for any setup needed before commands run
            const verbose = thisCommand.opts().verbose;
            // stderr: this runs before any command's action, so before --json has
            // routed human output away from stdout.
            if (verbose) {
                console.error(colors.muted('Running in verbose mode...'));
            }
        });
        // Add global options
        this.program.option('--verbose', 'Enable verbose output');
    }
    /**
     * Register all available commands.
     *
     * Every command registered here appears in `vast --help`. Ordered by the
     * everyday release flow rather than alphabetically: look, promote, ship.
     */
    registerCommands() {
        registerInitCommand(this.program);
        registerCloneCommand(this.program);
        registerStatusCommand(this.program);
        registerPendingCommand(this.program);
        registerDoctorCommand(this.program);
        registerPromoteCommand(this.program);
        registerReleaseCommand(this.program);
        registerDeployCommand(this.program);
        registerWorkflowCommand(this.program);
        registerProductionCommand(this.program);
        registerArgocdCommand(this.program);
        registerSlackCommand(this.program);
        registerBarCommand(this.program);
        registerUpgradeCommand(this.program);
        // Internal: refreshes the update cache and exits. Spawned detached by
        // maybeCheckForUpdates so the network call never sits in a user's way.
        this.program
            .command('__update-check', { hidden: true })
            .action(async () => {
            await refreshInBackground(Date.now());
        });
    }
    /**
     * Show a cached update hint, and detach a refresh if one is due.
     *
     * Both halves are free. The hint is read from a local file, and the refresh
     * runs in a detached child that this process does not wait on — so a slow or
     * unreachable GitHub cannot add a millisecond to any command. It also runs
     * BEFORE the command rather than after, because most commands end in
     * process.exit() and anything after would never execute.
     */
    maybeCheckForUpdates() {
        try {
            // stderr, not log.warn's stdout: a hint is a side note, and on stdout it
            // broke every `--json` (pending, status…) the moment an update was cached.
            const hint = pendingHint(VERSION);
            if (hint)
                console.error(colors.warning(`⚠ ${hint}`));
            if (isDue(readState(), Date.now())) {
                const child = spawn(process.execPath, [process.argv[1], '__update-check'], {
                    detached: true,
                    stdio: 'ignore',
                });
                child.unref();
            }
        }
        catch {
            // An update check must never be the reason a command fails.
        }
    }
    /**
     * Run the CLI
     */
    async run() {
        try {
            // Bare `vast` shows the same screen as `vast --help`. The header lives
            // inside that screen, so there is no separate banner to print.
            if (process.argv.slice(2).length === 0) {
                this.program.outputHelp();
                return;
            }
            // `vast -v`, `-V` and `--version` answer with the version. They are
            // handled here rather than as Commander options because a root-level
            // option is parsed anywhere on the line, which would swallow the `-v`
            // and `--version` that subcommands use for their own (--target-version,
            // upgrade and bar install's --version). Only the bare form qualifies.
            if (process.argv.length === 3 && ['-v', '-V', '--version'].includes(process.argv[2])) {
                process.stdout.write(`${VERSION}\n`);
                return;
            }
            // Skipped for the internal refresh itself, which would otherwise spawn
            // another one and recurse.
            if (process.argv[2] !== '__update-check')
                this.maybeCheckForUpdates();
            await this.program.parseAsync(process.argv);
        }
        catch (error) {
            // Global error handler
            reportUnexpectedError(error);
            process.exit(1);
        }
    }
}
//# sourceMappingURL=cli.js.map