/**
 * GitHub API utilities
 * 
 * Wrapper around the `gh` CLI for interacting with GitHub workflows
 * and repositories in the Vast-menu organization.
 */

import { execSync, spawn } from 'child_process';
import chalk from 'chalk';
import { createSpinner, log } from './ui.js';
import type { GitHubWorkflow, WorkflowRunParams, WorkflowRunResult } from '../types/index.js';

/** Vast-menu organization name */
const ORG_NAME = 'Vast-menu';

/**
 * Check if the gh CLI is installed and authenticated
 * @returns Promise<boolean> - true if gh is available and ready
 */
export async function checkGhCli(): Promise<boolean> {
  try {
    execSync('gh --version', { stdio: 'pipe' });
    execSync('gh auth status', { stdio: 'pipe' });
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
  const spinner = createSpinner(`Fetching workflows for ${ORG_NAME}/${repo}...`);
  spinner.start();
  
  try {
    const output = execSync(
      `gh workflow list --repo ${ORG_NAME}/${repo} --json name,id,path,state`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
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
    const statusIcon = wf.state === 'active' ? '🟢' : '⚪';
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
export async function runWorkflow(params: WorkflowRunParams): Promise<WorkflowRunResult> {
  const { repository, version, branch, workflowName, inputs } = params;
  
  const spinner = createSpinner(
    `Triggering workflow for ${repository} @ ${version} (${branch})...`
  );
  spinner.start();
  
  try {
    // Build the gh command
    let cmd = `gh workflow run`;
    
    // If a specific workflow name is provided, use it
    if (workflowName) {
      cmd += ` "${workflowName}"`;
    } else {
      // If no workflow name is provided, try to find a default one
      const workflows = await getWorkflows(repository);
      if (workflows.length === 0) {
        throw new Error(`No workflows found for ${repository}`);
      } else if (workflows.length === 1) {
        cmd += ` "${workflows[0].name}"`;
        log.info(`Using workflow: ${workflows[0].name}`);
      } else {
        // If multiple workflows exist, we can't guess which one to run
        // We could prompt the user, but for now let's throw an error
        // listing the available workflows
        const workflowNames = workflows.map(w => w.name).join(', ');
        throw new Error(`Multiple workflows found: ${workflowNames}. Please specify one with --workflow.`);
      }
    }
    
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
      encoding: 'utf-8', 
      stdio: ['pipe', 'pipe', 'pipe'] 
    });
    
    spinner.succeed(`Workflow triggered successfully!`);
    
    return {
      success: true,
      message: `Workflow triggered for ${repository} with version ${version} on branch ${branch}`,
    };
  } catch (error) {
    spinner.fail('Failed to trigger workflow');
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    return {
      success: false,
      error: errorMessage,
      message: 'Failed to trigger workflow',
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
    'staging': 'stage',
    'production': 'prod',
  };
  return map[branch.toLowerCase()] || branch;
}

/**
 * Find a pull request by title
 * @param repo - Repository name
 * @param title - PR title to search for
 * @returns PR number or null if not found
 */
export async function findPullRequest(repo: string, title: string): Promise<number | null> {
  try {
    // Escape quotes in title for the search query
    const escapedTitle = title.replace(/"/g, '\\"');
    const cmd = `gh pr list --repo ${ORG_NAME}/${repo} --search "${escapedTitle} in:title" --state open --json number --limit 1`;
    
    const output = execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
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
export async function mergePullRequest(repo: string, prNumber: number): Promise<void> {
  const cmd = `gh pr merge ${prNumber} --repo ${ORG_NAME}/${repo} --merge --delete-branch`;
  execSync(cmd, { stdio: ['pipe', 'pipe', 'pipe'] });
}

/**
 * Wait for the latest workflow run to complete
 * @param repo - Repository name
 * @param branch - Branch name
 * @param workflowName - Optional workflow name
 * @returns true if successful, false otherwise
 */
export async function waitForWorkflowCompletion(
  repo: string, 
  branch: string, 
  workflowName?: string
): Promise<boolean> {
  // 1. Find the run ID
  let runId: number | null = null;
  let attempts = 0;
  
  // Try to find the run for up to 30 seconds
  while (!runId && attempts < 10) {
    try {
      let cmd = `gh run list --repo ${ORG_NAME}/${repo} --branch ${branch} --limit 1 --json databaseId,status,conclusion,createdAt`;
      if (workflowName) {
        cmd += ` --workflow "${workflowName}"`;
      }
      
      const output = execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
      const runs = JSON.parse(output) as Array<{ databaseId: number, createdAt: string }>;
      
      if (runs.length > 0) {
        // Check if created recently (within last 2 minutes)
        const createdAt = new Date(runs[0].createdAt).getTime();
        const now = Date.now();
        if (now - createdAt < 120000) {
          runId = runs[0].databaseId;
        }
      }
    } catch (e) {
      // Ignore errors while searching
    }
    
    if (!runId) {
      await new Promise(resolve => setTimeout(resolve, 3000));
      attempts++;
    }
  }
  
  if (!runId) {
    return false; // Could not find the run
  }
  
  // 2. Watch the run
  try {
    // We use `gh run watch` which blocks until completion
    execSync(`gh run watch ${runId} --repo ${ORG_NAME}/${repo} --exit-status`, { 
      stdio: 'inherit' // Let the user see the output
    });
    return true;
  } catch (e) {
    return false; // Non-zero exit code means failure
  }
}

/**
 * Get list of valid repositories in the organization
 * These are the repositories available for workflow management
 */
export const VALID_REPOSITORIES = [
  'VastmenuPwa',
  'VastmenuPwaV2', 
  'Vastmenu-Dashboard',
  'Vastmenu-Backend',
  'VastpayPwa',
  'Vastpay-Dashboard',
  'Vastpay-Backend',
  'Vast-menu-payments',
] as const;

/** Type for valid repository names */
export type ValidRepository = (typeof VALID_REPOSITORIES)[number];

/**
 * Validate if a repository name is in the allowed list
 * @param repo - Repository name to validate
 * @returns true if valid
 */
export function isValidRepository(repo: string): boolean {
  return VALID_REPOSITORIES.some(r => r.toLowerCase() === repo.toLowerCase());
}
