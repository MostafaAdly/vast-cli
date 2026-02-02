/**
 * Workflow Command
 *
 * Manages GitHub Actions workflows for Vast-menu repositories.
 * Supports triggering workflows with version and branch parameters.
 *
 * Usage: vast workflow <repository> --version <version> --branch <branch> [options]
 */
import { Command } from 'commander';
/** Command metadata */
export declare const COMMAND_NAME = "workflow";
export declare const COMMAND_DESCRIPTION = "Run GitHub Actions workflows for Vast-menu repositories";
export declare const COMMAND_ALIASES: string[];
/**
 * Register the workflow command with the CLI program
 * @param program - Commander program instance
 */
export declare function registerWorkflowCommand(program: Command): void;
//# sourceMappingURL=workflow.d.ts.map