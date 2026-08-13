/**
 * Git operations for the release chain.
 *
 * Conflict detection uses `git merge-tree --write-tree`, which computes the
 * merge in memory. Nothing is checked out and the index is never touched, so a
 * refused promotion cannot strand a half-merged working tree.
 */

import { execFile, execFileSync } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Branches this CLI must never push to.
 *
 * `production` is here as a hard backstop independent of the production lock:
 * even with the lock lifted, production is reached through a reviewed
 * release/X.Y.Z pull request, never a direct push from this tool.
 */
export const NEVER_PUSH = ['production', 'prod', 'main', 'master'];

function git(dir: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: dir,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

export function isClean(dir: string): boolean {
  return git(dir, ['status', '--porcelain']).trim() === '';
}

export function currentBranch(dir: string): string {
  return git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
}

/**
 * Fast-forward a local branch to its remote counterpart.
 *
 * The promotion itself merges `origin/<branch>`, so the merged content was
 * always current — but the local branches were left untouched, so after a
 * promote you were looking at a stale `develop`. On this machine local develop
 * sat 24 commits behind origin/develop.
 *
 * Fast-forward only. If the local branch has its own commits this refuses
 * rather than rewriting anything, and the caller carries on: the promotion does
 * not depend on the local ref.
 *
 * @returns commits gained, or 0 if there was nothing to do.
 * @throws when the local branch has diverged from its remote.
 */
export function syncLocalBranch(dir: string, branch: string): number {
  try {
    git(dir, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]);
  } catch {
    return 0; // no local branch — nothing to sync
  }

  const { ahead: gained } = aheadBehind(dir, `origin/${branch}`, branch);
  if (gained === 0) return 0;

  if (currentBranch(dir) === branch) {
    git(dir, ['merge', '--ff-only', `origin/${branch}`]);
  } else {
    // Updates a branch that is not checked out. Without a leading '+' this
    // refspec is fast-forward-only, so divergence fails instead of clobbering.
    git(dir, ['fetch', 'origin', `${branch}:${branch}`]);
  }

  return gained;
}

export function fetch(dir: string): void {
  git(dir, ['fetch', '--prune', 'origin']);
}

/**
 * Refspecs that update only the remote-tracking branches we actually read.
 *
 * A bare `git fetch origin` pulls every branch and tag. These repos carry
 * dozens of stale release/* and hotfix/* branches, none of which any command
 * here looks at.
 */
export function refspecsFor(branches: string[]): string[] {
  return branches.map((b) => `+refs/heads/${b}:refs/remotes/origin/${b}`);
}

/**
 * Fetch specific branches, without blocking on the rest of the remote.
 *
 * Async so callers can run many repos concurrently — fetching is network-bound,
 * so N repos in parallel costs roughly one repo's latency instead of N.
 *
 * A refspec naming a branch the remote does not have aborts the whole fetch
 * ("couldn't find remote ref"), and not every repo has every branch —
 * Vast-Finance has no `staging` or `production` at all. So the combined fetch
 * is a fast path, and on failure each branch is retried on its own and the
 * missing ones are skipped.
 *
 * @returns true if at least one branch was updated.
 */
export async function fetchBranches(dir: string, branches: string[]): Promise<boolean> {
  const run = (refs: string[]): Promise<unknown> =>
    execFileAsync('git', ['fetch', '--no-tags', 'origin', ...refspecsFor(refs)], {
      cwd: dir,
      encoding: 'utf-8',
    });

  try {
    await run(branches);
    return true;
  } catch {
    const results = await Promise.allSettled(branches.map((b) => run([b])));
    return results.some((r) => r.status === 'fulfilled');
  }
}

/** Commits `a` has that `b` lacks, and vice versa. */
export function aheadBehind(dir: string, a: string, b: string): { ahead: number; behind: number } {
  const out = git(dir, ['rev-list', '--left-right', '--count', `${b}...${a}`]).trim();
  const [behind, ahead] = out.split(/\s+/).map(Number);
  return { ahead, behind };
}

export interface TrialMergeResult {
  clean: boolean;
  /** Paths that conflict. Empty when clean. */
  conflicts: string[];
}

/** Computes the merge in memory. Never mutates the working tree or index. */
export function trialMerge(dir: string, into: string, from: string): TrialMergeResult {
  try {
    git(dir, ['merge-tree', '--write-tree', '--name-only', into, from]);
    return { clean: true, conflicts: [] };
  } catch (error) {
    // Exit code 1 means conflicts. Verified against git 2.50, stdout is:
    //
    //     <tree oid>
    //     <conflicted path>...
    //     <blank line>
    //     Auto-merging ... / CONFLICT (content): ...   <- commentary, not paths
    //
    // so the paths are the lines before the blank, minus the leading tree oid.
    const stdout = String((error as { stdout?: unknown })?.stdout ?? '');
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
export function mergeAndPush(dir: string, into: string, from: string): void {
  if (NEVER_PUSH.includes(into.toLowerCase())) {
    throw new Error(
      `Refusing to push to "${into}". This CLI never pushes to a protected branch; ` +
        `production is reached only through a reviewed release/X.Y.Z pull request.`,
    );
  }
  git(dir, ['checkout', into]);
  git(dir, ['merge', '--ff-only', `origin/${into}`]);
  git(dir, ['merge', '--no-edit', from]);
  git(dir, ['push', 'origin', into]);
}
