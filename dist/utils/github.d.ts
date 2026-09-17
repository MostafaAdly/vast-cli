/**
 * GitHub API utilities
 *
 * Wrapper around the `gh` CLI for interacting with GitHub workflows
 * and repositories in the Vast-menu organization.
 */
import type { RunStatus } from "./run-poll.js";
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
export interface RunWorkflowOptions {
    /**
     * Suppress the spinner and the resolved-workflow line.
     *
     * The deploy path draws a status board that tracks the cursor by counting its
     * own lines, so a spinner painting over it would scroll every row out from
     * under it. Board-driven callers dispatch quietly and report on their own row.
     */
    quiet?: boolean;
}
export declare function runWorkflow(params: WorkflowRunParams, options?: RunWorkflowOptions): Promise<WorkflowRunResult>;
/**
 * The name of the step that failed in a run, or null.
 *
 * The one distinction that matters to a human: a run that failed while
 * committing the tag into Vast-deployments has usually already BUILT and pushed
 * the image, so the fix is a retry of the commit, not of the whole build.
 */
export declare function failedStepName(repo: string, runId: number): Promise<string | null>;
/**
 * A run's current status, read without blocking the process.
 *
 * The deploy path watches several runs concurrently, which `gh run watch`
 * cannot do: under execSync it freezes the event loop for the whole build and
 * repaints the terminal the status board owns. gh reports an empty conclusion
 * until the run completes; that is surfaced as null.
 */
export declare function getRunStatus(repo: string, runId: number): Promise<RunStatus>;
/** Where a human goes to read a run's failed steps. */
export declare function runUrl(repo: string, runId: number): string;
//# sourceMappingURL=github.d.ts.map