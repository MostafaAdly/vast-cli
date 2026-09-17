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
 * Is this branch one the CLI must never dispatch on?
 *
 * The list is NEVER_PUSH itself rather than a second copy of it: the two drifted
 * once already (`master` was pushable through `workflow` but not through git),
 * and an untrimmed `-b ' production'` slipped past the old membership test.
 */
export declare function isProtectedBranch(branch: string): boolean;
/**
 * Register the workflow command with the CLI program
 * @param program - Commander program instance
 */
export declare function registerWorkflowCommand(program: Command): void;
//# sourceMappingURL=workflow.d.ts.map