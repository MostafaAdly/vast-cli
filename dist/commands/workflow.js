/**
 * Workflow Command
 *
 * Manages GitHub Actions workflows for Vast-menu repositories.
 * Supports triggering workflows with version and branch parameters.
 *
 * Usage: vast workflow <repository> --version <version> --branch <branch> [options]
 */
import chalk from 'chalk';
import { runWorkflow, listWorkflows, checkGhCli, getEnvName, findPullRequest, mergePullRequest, waitForWorkflowCompletion, } from '../utils/github.js';
import { getRepo, repoNames } from '../config/repos.js';
import { isProductionEnabled, PRODUCTION_LOCKED_MESSAGE } from '../config/production-lock.js';
import { confirmProduction } from './deploy.js';
import { createHeader, createSuccessBox, createErrorBox, createInfoBox, createSpinner, log, formatKeyValue, formatList, } from '../utils/ui.js';
/** Command metadata */
export const COMMAND_NAME = 'workflow';
export const COMMAND_DESCRIPTION = 'Run GitHub Actions workflows for Vast-menu repositories';
export const COMMAND_ALIASES = ['wf', 'run'];
/**
 * Execute the workflow command
 * @param repo - Repository name
 * @param options - Command options
 */
async function executeWorkflow(repo, options) {
    // Validate gh CLI is available
    const ghAvailable = await checkGhCli();
    if (!ghAvailable) {
        console.log(createErrorBox('GitHub CLI (gh) not available', 'Please install gh CLI and authenticate with: gh auth login'));
        process.exit(1);
    }
    // Validate repository
    if (!repo) {
        console.log(createErrorBox('Repository name is required', `Usage: vast workflow <repository> --target-version <version> --branch <branch>\n\nAvailable repositories:\n${formatList(repoNames())}`));
        process.exit(1);
    }
    if (!getRepo(repo)) {
        console.log(createErrorBox(`Invalid repository: ${repo}`, `Valid repositories:\n${formatList(repoNames())}`));
        process.exit(1);
    }
    // List mode: show workflows and exit
    if (options.list) {
        console.log(createHeader('Workflow List', `${repo} | Vast-menu`));
        await listWorkflows(repo);
        return;
    }
    // Validate required parameters
    if (!options.targetVersion || !options.branch) {
        console.log(createErrorBox('Required parameters missing', `Both --target-version and --branch are required.\n\nExample:\n  vast workflow ${repo} --target-version 1.2.3 -b main`));
        process.exit(1);
    }
    // Validate version format (semantic versioning)
    const versionRegex = /^(\d+)\.(\d+)\.(\d+)(-[a-zA-Z0-9.]+)?$/;
    if (!versionRegex.test(options.targetVersion)) {
        console.log(createErrorBox('Invalid version format', `Version must follow semantic versioning: X.Y.Z or X.Y.Z-prerelease\n\nExamples: 1.2.3, 2.0.0-beta, 999.0.0-test`));
        process.exit(1);
    }
    // Display header
    console.log(createHeader('Workflow Trigger', `${repo} | ${options.branch} | v${options.targetVersion}`));
    // Parse additional inputs
    const parsedInputs = {};
    if (options.inputs) {
        for (const input of options.inputs) {
            const [key, value] = input.split('=');
            if (key && value !== undefined) {
                parsedInputs[key] = value;
            }
        }
    }
    // Dry run mode
    if (options.dryRun) {
        console.log(createInfoBox('Dry Run Mode - Parameters', [
            formatKeyValue('Repository', repo),
            formatKeyValue('Version', options.targetVersion),
            formatKeyValue('Branch', options.branch),
            formatKeyValue('Workflow', options.workflow || '(default)'),
            ...(Object.entries(parsedInputs).map(([k, v]) => formatKeyValue(`Input: ${k}`, v))),
        ]));
        log.muted('\nNo workflow was triggered (dry-run mode)');
        return;
    }
    // Production is locked by default and requires an explicit confirmation.
    const protectedBranches = ['production', 'prod', 'main'];
    if (protectedBranches.includes(options.branch.toLowerCase())) {
        if (!isProductionEnabled()) {
            console.log(createErrorBox(`Refusing to dispatch on ${options.branch}`, PRODUCTION_LOCKED_MESSAGE));
            process.exit(1);
        }
        log.warn(`⚠️  You are targeting the ${chalk.bold(options.branch)} branch!`);
        if (!(await confirmProduction(repo, options.targetVersion))) {
            log.info('Aborted.');
            process.exit(0);
        }
    }
    // Execute the workflow
    const result = await runWorkflow({
        repository: repo,
        version: options.targetVersion,
        branch: options.branch,
        workflowName: options.workflow,
        inputs: parsedInputs,
    });
    if (result.success) {
        console.log(createSuccessBox('Workflow triggered successfully!', `Repository: ${repo}\nVersion: ${options.targetVersion}\nBranch: ${options.branch}`));
        // Auto-approve logic
        if (options.approve) {
            log.newline();
            log.info('Waiting for workflow to complete to merge PR...');
            if (!result.runId) {
                log.error('Could not identify the dispatched run. Not merging.');
                process.exit(1);
            }
            const workflowSuccess = await waitForWorkflowCompletion(repo, result.runId);
            if (!workflowSuccess) {
                log.error('Workflow failed or could not be found. Cannot merge PR.');
                process.exit(1);
            }
            log.success('Workflow completed successfully!');
            // Construct expected PR title
            const env = getEnvName(options.branch);
            const prTitle = `chore: bump version to ${options.targetVersion} in ${env} environment`;
            const spinner = createSpinner('Looking for Pull Request...');
            spinner.start();
            // Poll for PR
            let prNumber = null;
            let attempts = 0;
            const pollInterval = 20000; // 20 seconds
            const maxPollDuration = 15 * 60 * 1000; // 15 minutes
            const maxAttempts = Math.ceil(maxPollDuration / pollInterval);
            while (!prNumber && attempts < maxAttempts) {
                prNumber = await findPullRequest(repo, prTitle);
                if (!prNumber) {
                    // Update spinner to show we are still waiting
                    const elapsed = Math.round((attempts * pollInterval) / 1000);
                    spinner.text = `Looking for Pull Request... (${elapsed}s elapsed)`;
                    await new Promise(resolve => setTimeout(resolve, pollInterval));
                    attempts++;
                }
            }
            if (prNumber) {
                spinner.text = `Merging PR #${prNumber}...`;
                // Retry logic for merge
                let mergeSuccess = false;
                let mergeAttempts = 0;
                const maxMergeRetries = 3;
                while (!mergeSuccess && mergeAttempts < maxMergeRetries) {
                    try {
                        if (mergeAttempts > 0) {
                            spinner.text = `Merging PR #${prNumber}... (Attempt ${mergeAttempts + 1}/${maxMergeRetries})`;
                        }
                        await mergePullRequest(repo, prNumber);
                        mergeSuccess = true;
                        spinner.succeed(`PR #${prNumber} merged and branch deleted successfully!`);
                    }
                    catch (error) {
                        mergeAttempts++;
                        if (mergeAttempts >= maxMergeRetries) {
                            spinner.fail(`Failed to merge PR #${prNumber} after ${maxMergeRetries} attempts`);
                            log.error(error instanceof Error ? error.message : String(error));
                        }
                        else {
                            // Wait a bit before retrying
                            await new Promise(resolve => setTimeout(resolve, 5000));
                        }
                    }
                }
            }
            else {
                spinner.fail('Pull Request not found');
                log.warn(`Could not find PR with title: "${prTitle}"`);
                log.warn('It might take a moment to appear, or the workflow might have failed to create it.');
            }
        }
    }
    else {
        console.log(createErrorBox('Failed to trigger workflow', result.error || 'Unknown error occurred'));
        process.exit(1);
    }
}
/**
 * Register the workflow command with the CLI program
 * @param program - Commander program instance
 */
export function registerWorkflowCommand(program) {
    const cmd = program
        .command(COMMAND_NAME)
        .description(COMMAND_DESCRIPTION)
        .alias('wf')
        .argument('[repository]', 'Repository name (e.g., VastmenuPwa)')
        .option('-v, --target-version <version>', 'Version to deploy (e.g., 1.2.3)')
        .option('-b, --branch <branch>', 'Target branch (e.g., staging, production)')
        .option('-w, --workflow <name>', 'Specific workflow name (if multiple exist)')
        .option('-l, --list', 'List available workflows instead of running', false)
        .option('-n, --dry-run', 'Validate parameters without triggering workflow', false)
        .option('--verbose', 'Show detailed output', false)
        .option('-a, --approve', 'Wait for the run, then merge the resulting bump PR', false)
        .option('-i, --inputs <pairs...>', 'Additional workflow inputs (key=value)')
        .addHelpText('after', `
Examples:
  # Trigger workflow for staging
  $ vast workflow Vast-menu-payments --target-version 999.0.0-test --branch staging

  # List available workflows
  $ vast workflow VastmenuPwa --list

  # Dry run to validate parameters
  $ vast workflow Vastmenu-Dashboard --target-version 1.2.3 --branch production --dry-run

  # With additional inputs
  $ vast workflow Vastmenu-Backend --target-version 2.0.0 --branch main --inputs environment=prod debug=true

Prefer \`vast release\` for the everyday staging flow — it promotes, derives the
version from the deployed Helm tag, and deploys in one command.

Available Repositories:
${repoNames().map(r => `  • ${r}`).join('\n')}
    `)
        .action(executeWorkflow);
}
//# sourceMappingURL=workflow.js.map