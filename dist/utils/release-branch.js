/**
 * The production code path: a reviewed release/X.Y.Z pull request.
 *
 * Production is never merged into directly. The branch is cut from production,
 * staging is merged into it, and a PR is opened for review. Merging that PR is
 * a human action — nothing here does it, and nothing here can.
 */
import { execFileSync } from 'child_process';
import { stripRc } from './version.js';
import { trialMerge } from './git.js';
import { log } from './ui.js';
const ORG_NAME = 'Vast-menu';
function git(dir, args) {
    return execFileSync('git', args, { cwd: dir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
}
export function releaseBranchName(version) {
    return `release/${stripRc(version)}`;
}
/** @returns the PR URL, or null if nothing was opened. */
export function cutReleaseBranch(dir, repo, version, dryRun) {
    const branch = releaseBranchName(version);
    const trial = trialMerge(dir, 'origin/production', 'origin/staging');
    if (!trial.clean) {
        log.error(`staging → production conflicts in ${trial.conflicts.length} file(s):`);
        for (const f of trial.conflicts)
            log.error(`  • ${f}`);
        return null;
    }
    if (dryRun) {
        log.muted(`  (dry run — would cut ${branch} and open a PR into production)`);
        return null;
    }
    git(dir, ['checkout', '-B', branch, 'origin/production']);
    git(dir, ['merge', '--no-edit', 'origin/staging']);
    git(dir, ['push', '-u', 'origin', branch]);
    const url = execFileSync('gh', [
        'pr',
        'create',
        '--repo',
        `${ORG_NAME}/${repo}`,
        '--base',
        'production',
        '--head',
        branch,
        '--title',
        `release: ${stripRc(version)} to production`,
        '--body',
        `Promotes \`staging\` to \`production\` for release ${stripRc(version)}.\n\n` +
            `After merging, deploy with:\n\n    vast deploy ${repo} --to production\n`,
    ], { encoding: 'utf-8' }).trim();
    log.success(`${repo}: opened ${url}`);
    return url;
}
//# sourceMappingURL=release-branch.js.map