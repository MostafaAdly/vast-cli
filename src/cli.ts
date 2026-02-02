/**
 * Main CLI Entry Point
 * 
 * Bootstraps the Vast CLI application, registers all commands,
 * and handles global error handling and help text.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import boxen from 'boxen';
import { registerWorkflowCommand } from './commands/workflow.js';
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
   * Register all available commands
   * New commands are added here
   */
  private registerCommands(): void {
    // Register the workflow command
    registerWorkflowCommand(this.program);

    // Future commands can be registered here:
    // registerDeployCommand(this.program);
    // registerStatusCommand(this.program);
    // registerLogsCommand(this.program);
  }

  /**
   * Display custom banner/help
   */
  private displayBanner(): void {
    const banner = boxen(
      chalk.hex('#6366F1').bold(' Vast CLI ') + chalk.hex('#8B5CF6')('v' + VERSION) + '\n' +
      chalk.gray('Manage Vast-menu workflows with ease'),
      {
        padding: 1,
        borderStyle: 'round',
        borderColor: '#6366F1',
        dimBorder: false,
        textAlignment: 'center',
      }
    );
    console.log(banner);
    console.log();
  }

  /**
   * Run the CLI
   */
  public async run(): Promise<void> {
    try {
      // Display banner for top-level help or when no args provided
      const args = process.argv.slice(2);
      if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
        this.displayBanner();
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
