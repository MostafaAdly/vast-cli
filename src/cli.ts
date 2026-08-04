/**
 * Main CLI Entry Point
 * 
 * Bootstraps the Vast CLI application, registers all commands,
 * and handles global error handling and help text.
 */

import { Command, Help } from 'commander';
import chalk from 'chalk';
import { renderRootHelp } from './utils/help.js';
import { registerWorkflowCommand } from './commands/workflow.js';
import { registerStatusCommand } from './commands/status.js';
import { registerPromoteCommand } from './commands/promote.js';
import { registerDeployCommand } from './commands/deploy.js';
import { registerReleaseCommand } from './commands/release.js';
import { registerProductionCommand } from './commands/production.js';
import { log } from './utils/ui.js';

/** CLI version */
const VERSION = '1.0.0';

/** CLI description */
const DESCRIPTION = 'CLI toolkit for Vast-menu GitHub workflow management';

export class VastCli {
  private program: Command;

  constructor() {
    this.program = new Command();
    this.configure();
    this.registerCommands();
  }

  /**
   * Configure the base CLI program
   */
  private configure(): void {
    this.program
      .name('vast')
      .version(VERSION, '-V, --version', 'Display version number')
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
        formatHelp: (cmd, helper) =>
          cmd.parent === null
            ? renderRootHelp(VERSION)
            : Help.prototype.formatHelp.call(helper, cmd, helper),
      })
      .hook('preAction', (thisCommand) => {
        // Global pre-action hook for any setup needed before commands run
        const verbose = thisCommand.opts().verbose;
        if (verbose) {
          log.muted('Running in verbose mode...');
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
  private registerCommands(): void {
    registerStatusCommand(this.program);
    registerPromoteCommand(this.program);
    registerReleaseCommand(this.program);
    registerDeployCommand(this.program);
    registerWorkflowCommand(this.program);
    registerProductionCommand(this.program);
  }

  /**
   * Run the CLI
   */
  public async run(): Promise<void> {
    try {
      // Bare `vast` shows the same screen as `vast --help`. The header lives
      // inside that screen, so there is no separate banner to print.
      if (process.argv.slice(2).length === 0) {
        this.program.outputHelp();
        return;
      }

      await this.program.parseAsync(process.argv);
    } catch (error) {
      // Global error handler
      console.error();
      log.error('An unexpected error occurred:');
      
      if (error instanceof Error) {
        console.error(chalk.red(`  ${error.message}`));
        
        if (process.argv.includes('--verbose') && error.stack) {
          console.error();
          console.error(chalk.gray(error.stack));
        }
      } else {
        console.error(chalk.red(`  ${String(error)}`));
      }
      
      process.exit(1);
    }
  }
}
