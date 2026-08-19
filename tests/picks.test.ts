import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parsePickRef, resolvePicks } from '../src/utils/picks.js';

// ---------------------------------------------------------------- parsing ----

test('a bare number is a PR, never a short SHA', () => {
  assert.deepEqual(parsePickRef('812'), { kind: 'pr', number: 812 });
  // An all-digit string that LOOKS like a SHA prefix is still a PR — that is
  // the documented ambiguity rule.
  assert.deepEqual(parsePickRef('123456'), { kind: 'pr', number: 123456 });
});

test('#812 is a PR', () => {
  assert.deepEqual(parsePickRef('#812'), { kind: 'pr', number: 812 });
});

test('a SHA needs at least one letter', () => {
  assert.deepEqual(parsePickRef('abc1234'), { kind: 'sha', sha: 'abc1234' });
  assert.deepEqual(parsePickRef('ABC1234'), { kind: 'sha', sha: 'abc1234' });
});

test('a PR link carries its repo for the paste guard', () => {
  assert.deepEqual(parsePickRef('https://github.com/Vast-menu/VastPayPwa/pull/812'), {
    kind: 'pr',
    number: 812,
    repo: 'Vast-menu/VastPayPwa',
  });
});

test('a commit link resolves to its SHA', () => {
  assert.deepEqual(parsePickRef('https://github.com/Vast-menu/VastPayPwa/commit/abc1234def'), {
    kind: 'sha',
    sha: 'abc1234def',
    repo: 'Vast-menu/VastPayPwa',
  });
});

test('trailing slashes and whitespace are tolerated', () => {
  assert.deepEqual(parsePickRef('  https://github.com/Vast-menu/VastPayPwa/pull/9/  '), {
    kind: 'pr',
    number: 9,
    repo: 'Vast-menu/VastPayPwa',
  });
});

test('garbage is rejected, not guessed at', () => {
  assert.equal(parsePickRef(''), null);
  assert.equal(parsePickRef('not-a-ref'), null);
  assert.equal(parsePickRef('ghijklm'), null); // hex-length but not hex
  assert.equal(parsePickRef('https://github.com/Vast-menu/VastPayPwa'), null);
});

// -------------------------------------------------------------- resolution ---

/**
 * production ── base
 * staging    ── base ── on-staging ── merge(feature)      <- promotable
 * develop-only commit: NOT on staging                     <- must refuse
 */
function fixture(): { dir: string; shas: Record<string, string>; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'vast-picks-'));
  const git = (...a: string[]): string =>
    execFileSync('git', a, { cwd: dir, encoding: 'utf-8', stdio: 'pipe' }).trim();
  const commit = (file: string, msg: string): string => {
    writeFileSync(join(dir, file), `${msg}\n`);
    git('add', '.');
    git('commit', '-qm', msg);
    return git('rev-parse', 'HEAD');
  };

  git('init', '-q', '-b', 'production');
  git('config', 'user.email', 't@e.com');
  git('config', 'user.name', 'T');
  const base = commit('f.txt', 'base');

  git('checkout', '-qb', 'staging');
  const onStaging = commit('a.txt', 'on staging');

  git('checkout', '-qb', 'feature');
  const inFeature = commit('b.txt', 'in feature');
  git('checkout', '-q', 'staging');
  git('merge', '--no-ff', '-q', '-m', 'Merge pull request #7 from Vast-Menu/feature', 'feature');
  const mergeSha = git('rev-parse', 'HEAD');

  git('checkout', '-qb', 'develop', 'production');
  const developOnly = commit('c.txt', 'develop only');
  git('checkout', '-q', 'staging');

  // resolvePicks reads origin/* refs; alias them to the local branches.
  git('update-ref', 'refs/remotes/origin/staging', 'staging');
  git('update-ref', 'refs/remotes/origin/production', 'production');

  return {
    dir,
    shas: { base, onStaging, inFeature, mergeSha, developOnly },
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test('resolves a staging SHA, flags merges, orders by history', () => {
  const f = fixture();
  try {
    const { picks, errors } = resolvePicks(f.dir, 'Vast-menu', 'X', [
      f.shas.mergeSha, // typed newest-first on purpose
      f.shas.onStaging,
    ]);
    assert.deepEqual(errors, []);
    assert.equal(picks.length, 2);
    assert.equal(picks[0].sha, f.shas.onStaging, 'oldest must come first regardless of input order');
    assert.equal(picks[0].isMerge, false);
    assert.equal(picks[1].sha, f.shas.mergeSha);
    assert.equal(picks[1].isMerge, true, 'merge commit must be flagged for -m 1');
  } finally {
    f.cleanup();
  }
});

test('refuses a commit that is not on origin/staging', () => {
  const f = fixture();
  try {
    const { picks, errors } = resolvePicks(f.dir, 'Vast-menu', 'X', [f.shas.developOnly]);
    assert.equal(picks.length, 0);
    assert.match(errors[0] ?? '', /not on origin\/staging/);
  } finally {
    f.cleanup();
  }
});

test('refuses a commit already on origin/production', () => {
  const f = fixture();
  try {
    const { errors } = resolvePicks(f.dir, 'Vast-menu', 'X', [f.shas.base]);
    assert.match(errors[0] ?? '', /already on origin\/production/);
  } finally {
    f.cleanup();
  }
});

test('a link to the wrong repo is refused before any git work', () => {
  const f = fixture();
  try {
    const { errors } = resolvePicks(f.dir, 'Vast-menu', 'VastPayPwa', [
      'https://github.com/Vast-menu/VastMenuPwa/pull/5',
    ]);
    assert.match(errors[0] ?? '', /points at Vast-menu\/VastMenuPwa/);
  } finally {
    f.cleanup();
  }
});

test('duplicate refs collapse to one pick', () => {
  const f = fixture();
  try {
    const { picks, errors } = resolvePicks(f.dir, 'Vast-menu', 'X', [
      f.shas.onStaging,
      f.shas.onStaging.slice(0, 8),
    ]);
    assert.deepEqual(errors, []);
    assert.equal(picks.length, 1);
  } finally {
    f.cleanup();
  }
});

test('all errors are reported at once, not first-only', () => {
  const f = fixture();
  try {
    const { errors } = resolvePicks(f.dir, 'Vast-menu', 'X', ['garbage!', f.shas.developOnly]);
    assert.equal(errors.length, 2);
  } finally {
    f.cleanup();
  }
});
