/**
 * GitHub API utilities
 *
 * Wrapper around the `gh` CLI for interacting with GitHub workflows
 * and repositories in the Vast-menu organization.
 */
import { execFile, execSync } from "child_process";
import { promisify } from "util";
import chalk from "chalk";
import { createSpinner, log } from "./ui.js";
const execFileAsync = promisify(execFile);
/** Vast-menu organization name */
const ORG_NAME = "Vast-menu";
/**
 * Check if the gh CLI is installed and authenticated
 * @returns Promise<boolean> - true if gh is available and ready
 */
export async function checkGhCli() {
    try {
        execSync("gh --version", { stdio: "pipe" });
        execSync("gh auth status", { stdio: "pipe" });
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Get all workflows for a repository
 * @param repo - Repository name (without org prefix)
 * @returns Array of workflow definitions
 */
export async function getWorkflows(repo) {
    const spinner = createSpinner(`Fetching workflows for ${ORG_NAME}/${repo}...`);
    spinner.start();
    try {
        const output = execSync(`gh workflow list --repo ${ORG_NAME}/${repo} --json name,id,path,state`, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
        spinner.succeed(`Found workflows for ${repo}`);
        return JSON.parse(output);
    }
    catch (error) {
        spinner.fail(`Failed to fetch workflows for ${repo}`);
        if (error.stderr) {
            console.error(chalk.red(`GitHub CLI Error: ${error.stderr.toString()}`));
        }
        else if (error.message) {
            console.error(chalk.red(`Error: ${error.message}`));
        }
        throw new Error(`Repository "${repo}" not found or no workflows available`);
    }
}
/**
 * List all available workflows for display
 * @param repo - Repository name
 */
export async function listWorkflows(repo) {
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
        console.log(`     ${log.dim(`ID: ${wf.id} | Path: ${wf.path}`)}`);
    }
    log.newline();
}
export async function runWorkflow(params, options = {}) {
    const { repository, version, branch, workflowName, inputs } = params;
    const spinner = options.quiet
        ? null
        : createSpinner(`Triggering workflow for ${repository} @ ${version} (${branch})...`);
    spinner?.start();
    try {
        // Resolve the workflow name first — it is needed both to dispatch and to
        // identify the run we create.
        let resolvedWorkflow;
        if (workflowName) {
            resolvedWorkflow = workflowName;
        }
        else {
            const workflows = await getWorkflows(repository);
            if (workflows.length === 0) {
                throw new Error(`No workflows found for ${repository}`);
            }
            else if (workflows.length === 1) {
                resolvedWorkflow = workflows[0].name;
                if (!options.quiet)
                    log.info(`Using workflow: ${resolvedWorkflow}`);
            }
            else {
                const workflowNames = workflows.map((w) => w.name).join(", ");
                throw new Error(`Multiple workflows found: ${workflowNames}. Please specify one with --workflow.`);
            }
        }
        // Newest run id BEFORE dispatch, so the run we create can be identified
        // precisely. Matching "newest on the branch" instead would attach to a
        // concurrent deploy's run and merge the bump PR on its result.
        const newestRunId = () => {
            try {
                const out = execSync(`gh run list --repo ${ORG_NAME}/${repository} --workflow "${resolvedWorkflow}" --limit 1 --json databaseId`, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
                return JSON.parse(out)[0]?.databaseId ?? 0;
            }
            catch {
                return 0;
            }
        };
        const priorRunId = newestRunId();
        let cmd = `gh workflow run "${resolvedWorkflow}"`;
        cmd += ` --repo ${ORG_NAME}/${repository}`;
        cmd += ` --ref ${branch}`;
        // Add version as input
        const allInputs = { version, ...inputs };
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
        let runId;
        for (let i = 0; i < 20 && runId === undefined; i++) {
            await new Promise((r) => setTimeout(r, 3000));
            const newest = newestRunId();
            if (newest && newest !== priorRunId)
                runId = newest;
        }
        spinner?.succeed(`Workflow triggered successfully!`);
        return {
            success: true,
            runId,
            message: `Workflow triggered for ${repository} with version ${version} on branch ${branch}`,
        };
    }
    catch (error) {
        spinner?.fail("Failed to trigger workflow");
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        return {
            success: false,
            error: errorMessage,
            message: "Failed to trigger workflow",
        };
    }
}
/**
 * The name of the step that failed in a run, or null.
 *
 * The one distinction that matters to a human: a run that failed while
 * committing the tag into Vast-deployments has usually already BUILT and pushed
 * the image, so the fix is a retry of the commit, not of the whole build.
 */
export async function failedStepName(repo, runId) {
    try {
        const { stdout } = await execFileAsync("gh", ["run", "view", String(runId), "--repo", `${ORG_NAME}/${repo}`, "--json", "jobs"], { encoding: "utf-8" });
        const parsed = JSON.parse(stdout);
        for (const job of parsed.jobs ?? []) {
            for (const step of job.steps ?? []) {
                if (step.conclusion === "failure")
                    return step.name;
            }
        }
        return null;
    }
    catch {
        // Best-effort colour on a failure that is already being reported. Never
        // turn "the run failed" into "we could not read why the run failed".
        return null;
    }
}
/**
 * A run's current status, read without blocking the process.
 *
 * The deploy path watches several runs concurrently, which `gh run watch`
 * cannot do: under execSync it freezes the event loop for the whole build and
 * repaints the terminal the status board owns. gh reports an empty conclusion
 * until the run completes; that is surfaced as null.
 */
export async function getRunStatus(repo, runId) {
    const { stdout } = await execFileAsync("gh", ["run", "view", String(runId), "--repo", `${ORG_NAME}/${repo}`, "--json", "status,conclusion"], { encoding: "utf-8" });
    const parsed = JSON.parse(stdout);
    return { status: parsed.status, conclusion: parsed.conclusion || null };
}
/** Where a human goes to read a run's failed steps. */
export function runUrl(repo, runId) {
    return `https://github.com/${ORG_NAME}/${repo}/actions/runs/${runId}`;
}
// The repository list moved to src/config/repos.ts, which carries canonical
// GitHub spellings, per-repo workflow names, Helm paths, and branch models —
// and is drift-tested against vast-routines/scripts/repos.txt. The old
// VALID_REPOSITORIES array here was missing Vast-Finance entirely.
//# sourceMappingURL=github.js.map