import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const NOTES = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'release', 'notes.sh');

function run(args: string[]): { out: string; code: number } {
  try {
    return { out: execFileSync('bash', [NOTES, ...args], { encoding: 'utf-8' }), code: 0 };
  } catch (e) {
    const err = e as { stdout?: Buffer | string; status?: number };
    return { out: String(err.stdout ?? ''), code: err.status ?? 1 };
  }
}

/**
 * A repo with the shapes notes.sh has to tell apart: a real feature PR, the
 * CI's own version-bump PR, a ticket id that only exists in a branch name, and
 * a version-bump commit.
 */
function fixture(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'vast-notes-'));
  const git = (...a: string[]): string =>
    execFileSync('git', a, { cwd: dir, encoding: 'utf-8', stdio: 'pipe' });
  const commit = (file: string, body: string, msg: string): void => {
    writeFileSync(join(dir, file), `${body}\n`);
    git('add', '.');
    git('commit', '-qm', msg);
  };

  git('init', '-q', '-b', 'production');
  git('config', 'user.email', 't@e.com');
  git('config', 'user.name', 'T');
  commit('f.txt', 'base', 'initial');
  git('checkout', '-qb', 'staging');

  // Real merge commits, with a second parent. `git log --merges` matches on
  // parent count, not on the subject line, so a commit that merely reads like a
  // merge is invisible to it.
  git('checkout', '-qb', 'feat/thing-CU-abc123xyz');
  commit('a.txt', 'a', 'feat: add a thing');
  git('checkout', '-q', 'staging');
  git('merge', '--no-ff', '-q', '-m',
    'Merge pull request #101 from Vast-Menu/feat/thing-CU-abc123xyz', 'feat/thing-CU-abc123xyz');

  // The CI's own version-bump branch, which must be filtered out.
  git('checkout', '-qb', 'bump-stage-1.2.3-rc4');
  commit('b.txt', 'b', 'chore: bump version to 1.2.3-rc4 in stage environment');
  git('checkout', '-q', 'staging');
  git('merge', '--no-ff', '-q', '-m',
    'Merge pull request #102 from Vast-Menu/bump-stage-1.2.3-rc4', 'bump-stage-1.2.3-rc4');

  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function withFixture(fn: (dir: string) => void): void {
  const f = fixture();
  try {
    fn(f.dir);
  } finally {
    f.cleanup();
  }
}

test('lists a feature PR', () => {
  withFixture((dir) => {
    assert.match(run([dir, 'production', 'staging']).out, /^pr\t101\t/m);
  });
});

// The CI's own bump PRs describe the pipeline, not shipped work. QC has nothing
// to test in them.
test('excludes the version-bump PR', () => {
  withFixture((dir) => {
    assert.doesNotMatch(run([dir, 'production', 'staging']).out, /^pr\t102\t/m);
  });
});

test('lifts a ticket id out of a branch name', () => {
  withFixture((dir) => {
    assert.match(run([dir, 'production', 'staging']).out, /^ticket\tCU-ABC123XYZ\t/m);
  });
});

test('a ticket appears exactly once even when it is in several commits', () => {
  withFixture((dir) => {
    const hits = run([dir, 'production', 'staging']).out.match(/^ticket\tCU-ABC123XYZ/gm) ?? [];
    assert.equal(hits.length, 1);
  });
});

test('lists a real commit', () => {
  withFixture((dir) => {
    assert.match(run([dir, 'production', 'staging']).out, /^commit\t\w+\tfeat: add a thing$/m);
  });
});

test('excludes version-bump commits', () => {
  withFixture((dir) => {
    assert.doesNotMatch(run([dir, 'production', 'staging']).out, /chore: bump version to/);
  });
});

// Nothing to release is a normal outcome, not a failure — without an explicit
// exit the status would be the last grep's, which is 1 when it matches nothing.
test('an empty range exits 0 and prints nothing', () => {
  withFixture((dir) => {
    const r = run([dir, 'production', 'production']);
    assert.equal(r.code, 0);
    assert.equal(r.out.trim(), '');
  });
});

test('too few arguments exits 2', () => {
  assert.equal(run(['only-one']).code, 2);
});

test('an unknown ref exits 2', () => {
  withFixture((dir) => {
    assert.equal(run([dir, 'production', 'no-such-ref']).code, 2);
  });
});

test('a directory that is not a checkout exits 2', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vast-notes-plain-'));
  try {
    assert.equal(run([dir, 'a', 'b']).code, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
