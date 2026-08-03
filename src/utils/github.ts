/**
 * GitHub API utilities
 *
 * Wrapper around the `gh` CLI for interacting with GitHub workflows
 * and repositories in the Vast-menu organization.
 */

import { execSync, spawn } from "child_process";
import chalk from "chalk";
import { createSpinner, log } from "./ui.js";
import type {
  GitHubWorkflow,
  WorkflowRunParams,
  WorkflowRunResult,
} from "../types/index.js";

/** Vast-menu organization name */
const ORG_NAME = "Vast-menu";

/**
 * Check if the gh CLI is installed and authenticated
 * @returns Promise<boolean> - true if gh is available and ready
 */
export async function checkGhCli(): Promise<boolean> {
  try {
    execSync("gh --version", { stdio: "pipe" });
    execSync("gh auth status", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get all workflows for a repository
 * @param repo - Repository name (without org prefix)
 * @returns Array of workflow definitions
 */
export async function getWorkflows(repo: string): Promise<GitHubWorkflow[]> {
  const spinner = createSpinner(
    `Fetching workflows for ${ORG_NAME}/${repo}...`,
  );
  spinner.start();

  try {
    const output = execSync(
      `gh workflow list --repo ${ORG_NAME}/${repo} --json name,id,path,state`,
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
    );

    spinner.succeed(`Found workflows for ${repo}`);
    return JSON.parse(output) as GitHubWorkflow[];
  } catch (error: any) {
    spinner.fail(`Failed to fetch workflows for ${repo}`);
    if (error.stderr) {
      console.error(chalk.red(`GitHub CLI Error: ${error.stderr.toString()}`));
    } else if (error.message) {
      console.error(chalk.red(`Error: ${error.message}`));
    }
    throw new Error(`Repository "${repo}" not found or no workflows available`);
  }
}

/**
 * List all available workflows for display
 * @param repo - Repository name
 */
export async function listWorkflows(repo: string): Promise<void> {
  const workflows = await getWorkflows(repo);

  if (workflows.length === 0) {
    log.warn(`No workflows found in ${ORG_NAME}/${repo}`);
    return;
  }

  log.newline();
  log.highlight(`Workflows in ${ORG_NAME}/${repo}:`);
  log.newline();

  for (const wf of workflows) {
    const statusIcon = wf.state === "active" ? "🟢" : "⚪";
    console.log(`  ${statusIcon} ${wf.name}`);
    console.log(`     ${log.muted(`ID: ${wf.id} | Path: ${wf.path}`)}`);
  }

  log.newline();
}

/**
 * Run a specific workflow
 * @param params - Workflow run parameters
 * @returns Result of the workflow run attempt
 */
export async function runWorkflow(
  params: WorkflowRunParams,
): Promise<WorkflowRunResult> {
  const { repository, version, branch, workflowName, inputs } = params;

  const spinner = createSpinner(
    `Triggering workflow for ${repository} @ ${version} (${branch})...`,
  );
  spinner.start();

  try {
    // Resolve the workflow name first — it is needed both to dispatch and to
    // identify the run we create.
    let resolvedWorkflow: string;
    if (workflowName) {
      resolvedWorkflow = workflowName;
    } else {
      const workflows = await getWorkflows(repository);
      if (workflows.length === 0) {
        throw new Error(`No workflows found for ${repository}`);
      } else if (workflows.length === 1) {
        resolvedWorkflow = workflows[0].name;
        log.info(`Using workflow: ${resolvedWorkflow}`);
      } else {
        const workflowNames = workflows.map((w) => w.name).join(", ");
        throw new Error(
          `Multiple workflows found: ${workflowNames}. Please specify one with --workflow.`,
        );
      }
    }

    // Newest run id BEFORE dispatch, so the run we create can be identified
    // precisely. Matching "newest on the branch" instead would attach to a
    // concurrent deploy's run and merge the bump PR on its result.
    const newestRunId = (): number => {
      try {
        const out = execSync(
          `gh run list --repo ${ORG_NAME}/${repository} --workflow "${resolvedWorkflow}" --limit 1 --json databaseId`,
          { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
        );
        return (JSON.parse(out)[0]?.databaseId as number) ?? 0;
      } catch {
        return 0;
      }
    };
    const priorRunId = newestRunId();

    let cmd = `gh workflow run "${resolvedWorkflow}"`;
    cmd += ` --repo ${ORG_NAME}/${repository}`;
    cmd += ` --ref ${branch}`;

    // Add version as input
    const allInputs: Record<string, string> = { version, ...inputs };

    // Add inputs as key=value pairs
    for (const [key, value] of Object.entries(allInputs)) {
      cmd += ` --field ${key}="${value}"`;
    }

    // Execute the command
    execSync(cmd, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Poll for a run newer than the one seen before dispatching.
    let runId: number | undefined;
    for (let i = 0; i < 20 && runId === undefined; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const newest = newestRunId();
      if (newest && newest !== priorRunId) runId = newest;
    }

    spinner.succeed(`Workflow triggered successfully!`);

    return {
      success: true,
      runId,
      message: `Workflow triggered for ${repository} with version ${version} on branch ${branch}`,
    };
  } catch (error) {
    spinner.fail("Failed to trigger workflow");

    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    return {
      success: false,
      error: errorMessage,
      message: "Failed to trigger workflow",
    };
  }
}

/**
 * Get the environment name from the branch name
 * @param branch - Branch name
 * @returns Environment name (stage, prod, or original branch)
 */
export function getEnvName(branch: string): string {
  const map: Record<string, string> = {
    staging: "stage",
    production: "prod",
  };
  return map[branch.toLowerCase()] || branch;
}

/**
 * Find a pull request by title
 * @param repo - Repository name
 * @param title - PR title to search for
 * @returns PR number or null if not found
 */
export async function findPullRequest(
  repo: string,
  title: string,
): Promise<number | null> {
  try {
    // Escape quotes in title for the search query
    const escapedTitle = title.replace(/"/g, '\\"');
    const cmd = `gh pr list --repo ${ORG_NAME}/${repo} --search "${escapedTitle} in:title" --state open --json number --limit 1`;

    const output = execSync(cmd, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    const prs = JSON.parse(output) as Array<{ number: number }>;

    return prs.length > 0 ? prs[0].number : null;
  } catch (error) {
    return null;
  }
}

/**
 * Merge a pull request
 * @param repo - Repository name
 * @param prNumber - PR number
 */
export async function mergePullRequest(
  repo: string,
  prNumber: number,
): Promise<void> {
  const cmd = `gh pr merge ${prNumber} --repo ${ORG_NAME}/${repo} --merge --delete-branch`;
  execSync(cmd, { stdio: ["pipe", "pipe", "pipe"] });
}

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
export async function waitForWorkflowCompletion(
  repo: string,
  runId: number,
): Promise<boolean> {
  try {
    execSync(`gh run watch ${runId} --repo ${ORG_NAME}/${repo} --exit-status`, {
      stdio: "inherit", // Let the user see the output
    });
    return true;
  } catch {
    return false; // Non-zero exit code means failure
  }
}

// The repository list moved to src/config/repos.ts, which carries canonical
// GitHub spellings, per-repo workflow names, Helm paths, and branch models —
// and is drift-tested against vast-routines/scripts/repos.txt. The old
// VALID_REPOSITORIES array here was missing Vast-Finance entirely.
