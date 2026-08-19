import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyReleaseMerged } from '../src/commands/deploy.js';

/**
 * A clone with a REAL origin (local bare repo), because verifyReleaseMerged
 * fetches — an update-ref alias would not survive that.
 *
 * origin has: production; release/1.0.1 merged into production;
 * hotfix/1.0.2 pushed but NOT merged.
 */
function fixture(): { clone: string; cleanup: () => void } {
  const base = mkdtempSync(join(tmpdir(), 'vast-gate-'));
  const upstream = join(base, 'upstream.git');
  const work = join(base, 'work');
  const clone = join(base, 'clone');
  const git = (dir: string, ...a: string[]): string =>
    execFileSync('git', a, { cwd: dir, encoding: 'utf-8', stdio: 'pipe' }).trim();

  execFileSync('git', ['init', '-q', '--bare', upstream], { stdio: 'pipe' });
  execFileSync('git', ['clone', '-q', upstream, work], { stdio: 'pipe' });
  git(work, 'config', 'user.email', 't@e.com');
  git(work, 'config', 'user.name', 'T');
  git(work, 'checkout', '-qb', 'production');
  writeFileSync(join(work, 'f.txt'), 'base\n');
  git(work, 'add', '.');
  git(work, 'commit', '-qm', 'base');

  git(work, 'checkout', '-qb', 'release/1.0.1');
  writeFileSync(join(work, 'r.txt'), 'released\n');
  git(work, 'add', '.');
  git(work, 'commit', '-qm', 'the release');
  git(work, 'checkout', '-q', 'production');
  git(work, 'merge', '-q', '--no-ff', '-m', 'merge release/1.0.1', 'release/1.0.1');

  git(work, 'checkout', '-qb', 'hotfix/1.0.2', 'production');
  writeFileSync(join(work, 'h.txt'), 'hot\n');
  git(work, 'add', '.');
  git(work, 'commit', '-qm', 'the hotfix');
  git(work, 'push', '-q', 'origin', 'production', 'release/1.0.1', 'hotfix/1.0.2');

  execFileSync('git', ['clone', '-q', upstream, clone], { stdio: 'pipe' });
  return { clone, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

test('a merged release branch passes the gate', async () => {
  const f = fixture();
  try {
    const gate = await verifyReleaseMerged(f.clone, '1.0.1');
    assert.equal(gate.ok, true);
    assert.match(gate.detail, /release\/1\.0\.1 is merged/);
  } finally {
    f.cleanup();
  }
});

// The exact state a selective hotfix creates on purpose: the branch exists,
// the human has not merged its PR yet.
test('an unmerged hotfix branch is refused with a merge-it-first message', async () => {
  const f = fixture();
  try {
    const gate = await verifyReleaseMerged(f.clone, '1.0.2');
    assert.equal(gate.ok, false);
    assert.match(gate.detail, /hotfix\/1\.0\.2 exists but its PR is not merged/);
  } finally {
    f.cleanup();
  }
});

test('a version with no branch at all is refused with guidance', async () => {
  const f = fixture();
  try {
    const gate = await verifyReleaseMerged(f.clone, '9.9.9');
    assert.equal(gate.ok, false);
    assert.match(gate.detail, /no release\/9\.9\.9 or hotfix\/9\.9\.9 branch/);
  } finally {
    f.cleanup();
  }
});

test('an rc suffix on the version is stripped before the branch lookup', async () => {
  const f = fixture();
  try {
    const gate = await verifyReleaseMerged(f.clone, '1.0.1-rc3');
    assert.equal(gate.ok, true);
  } finally {
    f.cleanup();
  }
});
