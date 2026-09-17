/**
 * Workflow Command
 *
 * Manages GitHub Actions workflows for Vast-menu repositories.
 * Supports triggering workflows with version and branch parameters.
 *
 * Usage: vast workflow <repository> --version <version> --branch <branch> [options]
 */
import chalk from 'chalk';
import { runWorkflow, listWorkflows, checkGhCli, runUrl, } from '../utils/github.js';
import { getRepo, repoNames } from '../config/repos.js';
import { isProductionEnabled, PRODUCTION_LOCKED_MESSAGE, PRODUCTION_NOT_READY_MESSAGE, productionPipelineReady, } from '../config/production-lock.js';
import { confirmProduction } from './deploy.js';
import { createHeader, createSuccessBox, createErrorBox, createInfoBox, log, formatKeyValue, formatList, } from '../utils/ui.js';
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
    // Production is blocked outright, and locked on top of that.
    const protectedBranches = ['production', 'prod', 'main'];
    if (protectedBranches.includes(options.branch.toLowerCase())) {
        // The block is a statement about the world, not a permission, so it is
        // checked first: lifting the lock must not get past it.
        if (!productionPipelineReady()) {
            console.log(createErrorBox(`Refusing to dispatch on ${options.branch}`, PRODUCTION_NOT_READY_MESSAGE));
            process.exit(1);
        }
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
        console.log(createSuccessBox('Workflow triggered successfully!', `Repository: ${repo}\nVersion: ${options.targetVersion}\nBranch: ${options.branch}` +
            (result.runId ? `\nRun: ${runUrl(repo, result.runId)}` : '')));
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

This is the escape hatch: it dispatches a workflow and stops. It does not watch
the run and it does not wait for ArgoCD, so it cannot tell you whether anything
reached the cluster.

Prefer \`vast release\` for the everyday staging flow — it promotes, derives the
version from the tag Vast-deployments says is live, dispatches, watches the run
and waits until ArgoCD reports the new tag Synced/Healthy.

Dispatching on production, prod or main is BLOCKED: production has not moved to
the new deploy pipeline yet.

Available Repositories:
${repoNames().map(r => `  • ${r}`).join('\n')}
    `)
        .action(executeWorkflow);
}
//# sourceMappingURL=workflow.js.map