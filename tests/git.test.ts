import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { trialMerge, aheadBehind, isClean, mergeAndPush, NEVER_PUSH } from '../src/utils/git.js';

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
