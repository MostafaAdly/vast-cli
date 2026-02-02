/**
 * GitHub API utilities
 *
 * Wrapper around the `gh` CLI for interacting with GitHub workflows
 * and repositories in the Vast-menu organization.
 */
import type { GitHubWorkflow, WorkflowRunParams, WorkflowRunResult } from '../types/index.js';
/**
 * Check if the gh CLI is installed and authenticated
 * @returns Promise<boolean> - true if gh is available and ready
 */
export declare function checkGhCli(): Promise<boolean>;
/**
 * Get all workflows for a repository
 * @param repo - Repository name (without org prefix)
 * @returns Array of workflow definitions
 */
export declare function getWorkflows(repo: string): Promise<GitHubWorkflow[]>;
/**
 * List all available workflows for display
 * @param repo - Repository name
 */
export declare function listWorkflows(repo: string): Promise<void>;
/**
 * Run a specific workflow
 * @param params - Workflow run parameters
 * @returns Result of the workflow run attempt
 */
export declare function runWorkflow(params: WorkflowRunParams): Promise<WorkflowRunResult>;
/**
 * Get the environment name from the branch name
 * @param branch - Branch name
 * @returns Environment name (stage, prod, or original branch)
 */
export declare function getEnvName(branch: string): string;
/**
 * Find a pull request by title
 * @param repo - Repository name
 * @param title - PR title to search for
 * @returns PR number or null if not found
 */
export declare function findPullRequest(repo: string, title: string): Promise<number | null>;
/**
 * Merge a pull request
 * @param repo - Repository name
 * @param prNumber - PR number
 */
export declare function mergePullRequest(repo: string, prNumber: number): Promise<void>;
/**
 * Wait for the latest workflow run to complete
 * @param repo - Repository name
 * @param branch - Branch name
 * @param workflowName - Optional workflow name
 * @returns true if successful, false otherwise
 */
export declare function waitForWorkflowCompletion(repo: string, branch: string, workflowName?: string): Promise<boolean>;
/**
 * Get list of valid repositories in the organization
 * These are the repositories available for workflow management
 */
export declare const VALID_REPOSITORIES: readonly ["VastmenuPwa", "VastmenuPwaV2", "Vastmenu-Dashboard", "Vastmenu-Backend", "VastpayPwa", "Vastpay-Dashboard", "Vastpay-Backend", "Vast-menu-payments"];
/** Type for valid repository names */
export type ValidRepository = (typeof VALID_REPOSITORIES)[number];
/**
 * Validate if a repository name is in the allowed list
 * @param repo - Repository name to validate
 * @returns true if valid
 */
export declare function isValidRepository(repo: string): boolean;
//# sourceMappingURL=github.d.ts.map