/**
 * Promote Command
 *
 * The merge half of the release chain: fast-forward both branches, verify the
 * merge is clean without touching the working tree, then merge and push.
 *
 * Refuses on conflict. It never attempts a resolution — a stranded half-merged
 * checkout is the exact failure this replaces.
 *
 * Production is different in kind: it opens a reviewed release/X.Y.Z pull
 * request and stops. Nothing here merges it, and it is gated on the production
 * lock being lifted.
 */
import { Option } from 'commander';
import { existsSync } from 'fs';
import { join } from 'path';
import { getRepo } from '../config/repos.js';
import { repoDir } from '../config/workspace.js';
import { isClean, fetch as gitFetch, aheadBehind, trialMerge, mergeAndPush, syncLocalBranch, } from '../utils/git.js';
import { readDeployedTag } from '../utils/helm.js';
import { stripRc } from '../utils/version.js';
import { cutReleaseBranch, RELEASE_KINDS } from '../utils/release-branch.js';
import { createHeader, createErrorBox, log } from '../utils/ui.js';
/**
 * Fast-forward the local branches this promotion reads, and say what came in.
 *
 * A branch that has diverged locally is reported and skipped rather than
 * aborting: the promotion merges `origin/*`, so its correctness never depended
 * on the local ref being current.
 */
function syncBranches(repo, dir, to) {
    const branches = to === 'production'
        ? ['staging', 'production']
        : [repo.promoteFrom.staging, 'staging'].filter((b) => Boolean(b));
    for (const branch of branches) {
        try {
            const gained = syncLocalBranch(dir, branch);
            if (gained > 0)
                log.muted(`  pulled ${gained} new commit(s) into ${branch}`);
        }
        catch {
            log.warn(`${branch} has local commits that are not on origin/${branch} — leaving it alone. ` +
                `The promotion still uses origin/${branch}.`);
        }
    }
}
/** @returns true when the promotion completed (or would have, under dryRun). */
export function promote(repo, dir, to, dryRun, kind = 'release', targetVersion, bodyMode = 'changelog') {
    // Deliberately NOT gated on the production lock. Cutting a branch and opening
    // a PR ships nothing; the lock guards the deploy that follows the merge.
    if (!existsSync(join(dir, '.git'))) {
        console.log(createErrorBox(`${repo.name} is not cloned`, `Expected a checkout at ${dir}`));
        return false;
    }
    if (!isClean(dir)) {
        console.log(createErrorBox(`${repo.name} has uncommitted changes`, 'Commit or stash them before promoting.'));
        return false;
    }
    gitFetch(dir);
    // Bring the local branches up to date with what was just fetched. The merge
    // below reads origin/* either way, so this is about not leaving the checkout
    // sitting on a stale develop after the promotion.
    syncBranches(repo, dir, to);
    if (to === 'production') {
        const helm = repo.helm.staging;
        if (!helm) {
            console.log(createErrorBox(`${repo.name}: no staging Helm values`, 'Cannot derive a release version.'));
            return false;
        }
        const { ahead } = aheadBehind(dir, 'origin/staging', 'origin/production');
        if (ahead === 0) {
            log.info(`${repo.name}: production already contains staging. Nothing to release.`);
            return true;
        }
        let version;
        if (targetVersion) {
            version = targetVersion;
        }
        else {
            try {
                version = stripRc(readDeployedTag(dir, 'origin/staging', helm));
            }
            catch (error) {
                console.log(createErrorBox(`${repo.name}: cannot derive a release version`, `${error instanceof Error ? error.message : String(error)}\n\n` +
                    `Re-run with an explicit version:\n` +
                    `    vast promote ${repo.name} --to production --target-version X.Y.Z`));
                return false;
            }
        }
        log.info(`${repo.name}: ${ahead} commit(s) staging → production, ${kind} ${version}`);
        return cutReleaseBranch(dir, repo.name, kind, version, dryRun, bodyMode) !== null || dryRun;
    }
    const from = repo.promoteFrom.staging;
    if (!from) {
        console.log(createErrorBox(`Cannot promote ${repo.name} into staging`, `No promotion source is configured. ${repo.name} has no usable \`develop\` — ` +
            `human PRs there target \`staging\` directly, so merging \`develop\` would ` +
            `regress it by hundreds of commits.`));
        return false;
    }
    const { ahead } = aheadBehind(dir, `origin/${from}`, 'origin/staging');
    if (ahead === 0) {
        log.info(`${repo.name}: staging already contains ${from}. Nothing to promote.`);
        return true;
    }
    const trial = trialMerge(dir, 'origin/staging', `origin/${from}`);
    if (!trial.clean) {
        console.log(createErrorBox(`${repo.name}: ${from} → staging conflicts`, `${trial.conflicts.length} conflicting file(s):\n` +
            trial.conflicts.map((f) => `  • ${f}`).join('\n') +
            `\n\nNothing was changed. Resolve these before promoting.`));
        return false;
    }
    log.info(`${repo.name}: ${ahead} commit(s) from ${from} → staging, merge is clean`);
    if (dryRun) {
        log.muted('  (dry run — no merge performed)');
        return true;
    }
    mergeAndPush(dir, 'staging', `origin/${from}`);
    log.success(`${repo.name}: ${from} → staging pushed`);
    return true;
}
async function executePromote(repoName, options) {
    const repo = getRepo(repoName);
    if (!repo) {
        log.error(`Unknown repository: ${repoName}`);
        process.exit(1);
    }
    if (options.to !== 'staging' && options.to !== 'production') {
        log.error(`Invalid --to value: ${options.to}. Use staging or production.`);
        process.exit(1);
    }
    if (!RELEASE_KINDS.includes(options.as)) {
        log.error(`Invalid --as value: ${options.as}. Use ${RELEASE_KINDS.join(' or ')}.`);
        process.exit(1);
    }
    const label = options.to === 'production' ? `→ production (${options.as})` : '→ staging';
    console.log(createHeader('Promote', `${repo.name} | ${label}`));
    // --no-changelog wins over --summarize: asking for no description at all is
    // the more specific request.
    const bodyMode = !options.changelog
        ? 'bare'
        : options.summarize || options.llm
            ? 'summarize'
            : 'changelog';
    const dir = repoDir(repo, options.dir);
    if (!dir) {
        console.log(createErrorBox(`${repo.name} is not cloned`, 'Run `vast init`, or clone it with `vast clone`.'));
        process.exit(1);
    }
    const ok = promote(repo, dir, options.to, options.dryRun, options.as, options.targetVersion, bodyMode);
    if (!ok)
        process.exit(1);
}
export function registerPromoteCommand(program) {
    program
        .command('promote')
        .description('Merge develop into staging, or open a release PR into production')
        .argument('<repository>', 'Repository name')
        .option('-t, --to <env>', 'Target environment: staging or production', 'staging')
        .option('--as <kind>', 'Production branch kind: release or hotfix', 'release')
        .option('-v, --target-version <version>', 'Override the derived release version')
        .option('--no-changelog', 'Open the PR with a bare description, no change summary')
        .option('-s, --summarize', 'Describe the diff with a small local model instead of commits')
        .addOption(new Option('--llm').hideHelp())
        .option('--dir <path>', 'Override the local checkout path')
        .option('-n, --dry-run', 'Report what would happen without merging', false)
        .addHelpText('after', `
Examples:
  $ vast promote VastPayPwa                             develop -> staging, push
  $ vast promote VastPayPwa --dry-run                   check conflicts, change nothing
  $ vast promote VastPayPwa --to production             cut release/X.Y.Z + PR
  $ vast promote VastPayPwa --to production --as hotfix cut hotfix/X.Y.Z + PR
  $ vast promote VastPayPwa --to production --no-changelog   bare PR description

PR description (production only):
  default          bullets from the commit subjects being promoted, grouped
                   into Features / Fixes / Improvements / Maintenance
  --summarize      a small local model reads the diff and describes it instead;
                   slower and not reproducible, but catches changes nobody
                   wrote a good commit message for. Falls back to the default
                   if it is unavailable or the output fails screening.
  --no-changelog   a one-line description

Descriptions never contain tool instructions or any note about how they were
produced — the whole team reads them.

Preparing a production release is NOT gated on the production lock — cutting a
branch and opening a PR ships nothing. The PR is opened for review and is never
merged by this tool; the deploy that follows is what the lock guards.
`)
        .action(executePromote);
}
//# sourceMappingURL=promote.js.map