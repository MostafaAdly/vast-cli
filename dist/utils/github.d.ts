/**
 * GitHub API utilities
 *
 * Wrapper around the `gh` CLI for interacting with GitHub workflows
 * and repositories in the Vast-menu organization.
 */
import type { GitHubWorkflow, WorkflowRunParams, WorkflowRunResult } from "../types/index.js";
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
 * Watch a specific run to completion.
 *
 * Takes the run id returned by runWorkflow rather than rediscovering it. The
 * previous "newest run on the branch, created under 2 minutes ago" heuristic
 * could attach to a concurrent deploy's run — and then a bump PR would be
 * merged on the strength of an unrelated run's success.
 *
 * @param repo - Repository name
 * @param runId - The run id returned by runWorkflow
 * @returns true if the run concluded successfully
 */
export declare function waitForWorkflowCompletion(repo: string, runId: number): Promise<boolean>;
//# sourceMappingURL=github.d.ts.map