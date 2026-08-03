/**
 * Git operations for the release chain.
 *
 * Conflict detection uses `git merge-tree --write-tree`, which computes the
 * merge in memory. Nothing is checked out and the index is never touched, so a
 * refused promotion cannot strand a half-merged working tree.
 */
import { execFileSync } from 'child_process';
/**
 * Branches this CLI must never push to.
 *
 * `production` is here as a hard backstop independent of the production lock:
 * even with the lock lifted, production is reached through a reviewed
 * release/X.Y.Z pull request, never a direct push from this tool.
 */
export const NEVER_PUSH = ['production', 'prod', 'main', 'master'];
function git(dir, args) {
    return execFileSync('git', args, {
        cwd: dir,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
    });
}
export function isClean(dir) {
    return git(dir, ['status', '--porcelain']).trim() === '';
}
export function fetch(dir) {
    git(dir, ['fetch', '--prune', 'origin']);
}
/** Commits `a` has that `b` lacks, and vice versa. */
export function aheadBehind(dir, a, b) {
    const out = git(dir, ['rev-list', '--left-right', '--count', `${b}...${a}`]).trim();
    const [behind, ahead] = out.split(/\s+/).map(Number);
    return { ahead, behind };
}
/** Computes the merge in memory. Never mutates the working tree or index. */
export function trialMerge(dir, into, from) {
    try {
        git(dir, ['merge-tree', '--write-tree', '--name-only', into, from]);
        return { clean: true, conflicts: [] };
    }
    catch (error) {
        // Exit code 1 means conflicts. Verified against git 2.50, stdout is:
        //
        //     <tree oid>
        //     <conflicted path>...
        //     <blank line>
        //     Auto-merging ... / CONFLICT (content): ...   <- commentary, not paths
        //
        // so the paths are the lines before the blank, minus the leading tree oid.
        const stdout = String(error?.stdout ?? '');
        const blank = stdout.indexOf('\n\n');
        const section = blank === -1 ? stdout : stdout.slice(0, blank);
        const conflicts = section
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean)
            .slice(1);
        return { clean: false, conflicts };
    }
}
/**
 * Merge `from` into `into` and push.
 *
 * Refuses outright for any branch in NEVER_PUSH. Only call after trialMerge
 * reports clean.
 */
export function mergeAndPush(dir, into, from) {
    if (NEVER_PUSH.includes(into.toLowerCase())) {
        throw new Error(`Refusing to push to "${into}". This CLI never pushes to a protected branch; ` +
            `production is reached only through a reviewed release/X.Y.Z pull request.`);
    }
    git(dir, ['checkout', into]);
    git(dir, ['merge', '--ff-only', `origin/${into}`]);
    git(dir, ['merge', '--no-edit', from]);
    git(dir, ['push', 'origin', into]);
}
//# sourceMappingURL=git.js.map