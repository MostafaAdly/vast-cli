import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syncLocalBranch, currentBranch, aheadBehind } from '../src/utils/git.js';

/**
 * A clone with a real `origin`, so the fast-forward paths exercise actual git
 * refspec behaviour rather than a stub.
 */
function fixture(): { clone: string; upstream: string; cleanup: () => void } {
  const base = mkdtempSync(join(tmpdir(), 'vast-sync-'));
  const upstream = join(base, 'upstream');
  const clone = join(base, 'clone');

  const git = (dir: string, ...args: string[]): string =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf-8', stdio: 'pipe' });

  execFileSync('git', ['init', '-q', '-b', 'main', upstream], { stdio: 'pipe' });
  git(upstream, 'config', 'user.email', 't@e.com');
  git(upstream, 'config', 'user.name', 'T');
  writeFileSync(join(upstream, 'f.txt'), 'base\n');
  git(upstream, 'add', '.');
  git(upstream, 'commit', '-qm', 'base');
  git(upstream, 'branch', 'develop');

  execFileSync('git', ['clone', '-q', upstream, clone], { stdio: 'pipe' });
  git(clone, 'config', 'user.email', 't@e.com');
  git(clone, 'config', 'user.name', 'T');
  git(clone, 'branch', 'develop', 'origin/develop');

  return { clone, upstream, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

function commitOn(dir: string, branch: string, text: string): void {
  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf-8', stdio: 'pipe' });
  git('checkout', '-q', branch);
  writeFileSync(join(dir, `${text}.txt`), `${text}\n`);
  git('add', '.');
  git('commit', '-qm', text);
}

test('syncing a branch that is already current is a no-op', () => {
  const f = fixture();
  try {
    assert.equal(syncLocalBranch(f.clone, 'develop'), 0);
  } finally {
    f.cleanup();
  }
});

// The reported bug: local develop sat 24 commits behind origin/develop after a
// promote, because nothing ever fast-forwarded it.
test('fast-forwards a branch that is not checked out', () => {
  const f = fixture();
  try {
    commitOn(f.upstream, 'develop', 'newer');
    execFileSync('git', ['fetch', '-q', 'origin'], { cwd: f.clone, stdio: 'pipe' });

    assert.equal(currentBranch(f.clone), 'main', 'precondition: develop is not checked out');
    assert.equal(aheadBehind(f.clone, 'origin/develop', 'develop').ahead, 1);

    assert.equal(syncLocalBranch(f.clone, 'develop'), 1);
    assert.equal(aheadBehind(f.clone, 'origin/develop', 'develop').ahead, 0);
    assert.equal(currentBranch(f.clone), 'main', 'must not change the checked-out branch');
  } finally {
    f.cleanup();
  }
});

test('fast-forwards the branch that IS checked out', () => {
  const f = fixture();
  try {
    commitOn(f.upstream, 'develop', 'newer');
    execFileSync('git', ['checkout', '-q', 'develop'], { cwd: f.clone, stdio: 'pipe' });
    execFileSync('git', ['fetch', '-q', 'origin'], { cwd: f.clone, stdio: 'pipe' });

    assert.equal(syncLocalBranch(f.clone, 'develop'), 1);
    assert.equal(aheadBehind(f.clone, 'origin/develop', 'develop').ahead, 0);
  } finally {
    f.cleanup();
  }
});

// Fast-forward only. Local work must never be silently rewritten.
test('refuses when the local branch has diverged', () => {
  const f = fixture();
  try {
    commitOn(f.upstream, 'develop', 'theirs');
    commitOn(f.clone, 'develop', 'mine');
    execFileSync('git', ['checkout', '-q', 'main'], { cwd: f.clone, stdio: 'pipe' });
    execFileSync('git', ['fetch', '-q', 'origin'], { cwd: f.clone, stdio: 'pipe' });

    assert.throws(() => syncLocalBranch(f.clone, 'develop'));

    // And the local commit survives.
    const subjects = execFileSync('git', ['log', '--pretty=%s', 'develop'], {
      cwd: f.clone,
      encoding: 'utf-8',
    });
    assert.match(subjects, /mine/, 'local work must not be discarded');
  } finally {
    f.cleanup();
  }
});

test('a branch with no local counterpart is skipped, not an error', () => {
  const f = fixture();
  try {
    assert.equal(syncLocalBranch(f.clone, 'no-such-branch'), 0);
  } finally {
    f.cleanup();
  }
});
