import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  cherryPickSequence,
  isAncestor,
  refExists,
  trialMerge,
  aheadBehind,
  isClean,
  mergeAndPush,
  refspecsFor,
  NEVER_PUSH,
} from '../src/utils/git.js';

function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'vast-git-'));
  const git = (...args: string[]): void => {
    execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  };

  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  writeFileSync(join(dir, 'f.txt'), 'base\n');
  git('add', '.');
  git('commit', '-qm', 'base');

  git('checkout', '-qb', 'feature');
  writeFileSync(join(dir, 'f.txt'), 'feature\n');
  git('commit', '-qam', 'feature');

  git('checkout', '-q', 'main');
  writeFileSync(join(dir, 'f.txt'), 'main\n');
  git('commit', '-qam', 'main');

  git('checkout', '-qb', 'clean-branch', 'main');
  writeFileSync(join(dir, 'other.txt'), 'other\n');
  git('add', '.');
  git('commit', '-qm', 'other');

  return dir;
}

function withFixture(fn: (dir: string) => void): void {
  const dir = fixture();
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('detects a conflicting merge and names the file', () => {
  withFixture((dir) => {
    const result = trialMerge(dir, 'main', 'feature');
    assert.equal(result.clean, false);
    assert.ok(result.conflicts.includes('f.txt'), `got ${JSON.stringify(result.conflicts)}`);
  });
});

test('trial merge leaves the working tree untouched', () => {
  withFixture((dir) => {
    trialMerge(dir, 'main', 'feature');
    assert.equal(isClean(dir), true, 'trial merge must not mutate the working tree');
  });
});

test('reports a clean merge as clean', () => {
  withFixture((dir) => {
    assert.equal(trialMerge(dir, 'main', 'clean-branch').clean, true);
  });
});

test('counts commits ahead and behind', () => {
  withFixture((dir) => {
    const { ahead, behind } = aheadBehind(dir, 'clean-branch', 'main');
    assert.equal(ahead, 1);
    assert.equal(behind, 0);
  });
});

// The backstop that makes "nothing is ever pushed to production" structural
// rather than a matter of every call site remembering to check.
test('refuses to push to any protected branch', () => {
  withFixture((dir) => {
    for (const branch of NEVER_PUSH) {
      assert.throws(
        () => mergeAndPush(dir, branch, 'origin/staging'),
        /Refusing to push to/,
        `${branch} should be refused`,
      );
    }
  });
});

test('protected branch check is case-insensitive', () => {
  withFixture((dir) => {
    assert.throws(() => mergeAndPush(dir, 'PRODUCTION', 'origin/staging'), /Refusing to push to/);
  });
});

// Narrowing the fetch is what keeps `status --all` off the dozens of stale
// release/* and hotfix/* branches these repos carry.
test('refspecs map branches onto their remote-tracking refs', () => {
  assert.deepEqual(refspecsFor(['staging', 'develop']), [
    '+refs/heads/staging:refs/remotes/origin/staging',
    '+refs/heads/develop:refs/remotes/origin/develop',
  ]);
});

test('refspecs for no branches is empty, not a wildcard', () => {
  assert.deepEqual(refspecsFor([]), []);
});

// ------------------------------------------------- cherry-pick sequencing ----

test('applies picks in order onto the current branch', () => {
  withFixture((dir) => {
    const git = (...a: string[]): string =>
      execFileSync('git', a, { cwd: dir, encoding: 'utf-8', stdio: 'pipe' }).trim();
    // clean-branch has "other.txt"; pick its tip onto a branch cut from main.
    const pick = git('rev-parse', 'clean-branch');
    git('checkout', '-qb', 'hotfix-test', 'main');
    const result = cherryPickSequence(dir, [{ sha: pick, isMerge: false }]);
    assert.equal(result.ok, true);
    assert.match(git('log', '--pretty=%s', '-1'), /other/);
  });
});

test('a conflicting pick aborts and leaves the tree clean', () => {
  withFixture((dir) => {
    const git = (...a: string[]): string =>
      execFileSync('git', a, { cwd: dir, encoding: 'utf-8', stdio: 'pipe' }).trim();
    // feature edits f.txt against main's version — guaranteed conflict.
    const pick = git('rev-parse', 'feature');
    git('checkout', '-qb', 'hotfix-conflict', 'main');
    const before = git('rev-parse', 'HEAD');
    const result = cherryPickSequence(dir, [{ sha: pick, isMerge: false }]);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.failedSha, pick);
      assert.ok(result.conflicts.includes('f.txt'), `got ${JSON.stringify(result.conflicts)}`);
    }
    assert.equal(git('rev-parse', 'HEAD'), before, 'no partial picks may remain');
    assert.equal(isClean(dir), true, 'the working tree must be restored');
  });
});

test('isAncestor answers both directions', () => {
  withFixture((dir) => {
    const git = (...a: string[]): string =>
      execFileSync('git', a, { cwd: dir, encoding: 'utf-8', stdio: 'pipe' }).trim();
    const root = git('rev-list', '--max-parents=0', 'main');
    assert.equal(isAncestor(dir, root, 'main'), true);
    assert.equal(isAncestor(dir, 'main', root), false);
    assert.equal(refExists(dir, 'main'), true);
    assert.equal(refExists(dir, 'no-such-ref'), false);
  });
});
