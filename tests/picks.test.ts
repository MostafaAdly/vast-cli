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

test('true garbage is rejected; ref-shaped strings become branch candidates', () => {
  assert.equal(parsePickRef(''), null);
  assert.equal(parsePickRef('has spaces'), null);
  assert.equal(parsePickRef('https://github.com/Vast-menu/VastPayPwa'), null); // no /tree/
  // These now resolve as branches — existence is checked at resolution, where
  // the error message can actually name the missing branch.
  assert.deepEqual(parsePickRef('fix/urgent-thing'), { kind: 'branch', name: 'fix/urgent-thing' });
  assert.deepEqual(parsePickRef('ghijklm'), { kind: 'branch', name: 'ghijklm' });
});

test('a branch link carries its repo for the paste guard', () => {
  assert.deepEqual(parsePickRef('https://github.com/Vast-menu/VastPayPwa/tree/fix/urgent'), {
    kind: 'branch',
    name: 'fix/urgent',
    repo: 'Vast-menu/VastPayPwa',
  });
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

// A bare number is a PR number by design (README: "a SHA needs a letter"), so
// a short SHA in a test must be cut where it still carries a letter. An 8-char
// prefix is all digits about once in forty fixtures, and that run used to
// reach out to gh for "PR 59039832" and fail — the suite's one flake.
function shortShaWithLetter(sha: string): string {
  const letter = sha.search(/[a-f]/);
  return sha.slice(0, Math.max(8, letter + 1));
}

test('duplicate refs collapse to one pick', () => {
  const f = fixture();
  try {
    const { picks, errors } = resolvePicks(f.dir, 'Vast-menu', 'X', [
      f.shas.onStaging,
      shortShaWithLetter(f.shas.onStaging),
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

// ------------------------------------------------ branch classification -----

/**
 * production ── base
 * develop    ── base ── dev-work (staging's fork parent)
 * staging    ── develop@dev-work ── merge(landed-feature)
 * prodfix    ── cut from production, 1 commit          -> case 1: true merge
 * landed     ── forked from staging, merged into it    -> case 2: landing merge
 * floating   ── forked from develop, unmerged          -> case 3: refused
 */
function branchFixture(): { dir: string; landingSha: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'vast-branch-'));
  const git = (...a: string[]): string =>
    execFileSync('git', a, { cwd: dir, encoding: 'utf-8', stdio: 'pipe' }).trim();
  const commit = (file: string, msg: string): void => {
    writeFileSync(join(dir, file), `${msg}\n`);
    git('add', '.');
    git('commit', '-qm', msg);
  };

  git('init', '-q', '-b', 'production');
  git('config', 'user.email', 't@e.com');
  git('config', 'user.name', 'T');
  commit('f.txt', 'base');

  git('checkout', '-qb', 'develop');
  commit('d.txt', 'dev work');
  git('checkout', '-qb', 'staging');

  git('checkout', '-qb', 'landed');
  commit('l.txt', 'landed work');
  git('checkout', '-q', 'staging');
  git('merge', '--no-ff', '-q', '-m', 'Merge pull request #9 from Vast-Menu/landed', 'landed');
  const landingSha = git('rev-parse', 'HEAD');

  git('checkout', '-q', 'develop');
  git('checkout', '-qb', 'floating');
  commit('x.txt', 'floating work');

  git('checkout', '-q', 'production');
  git('checkout', '-qb', 'prodfix');
  commit('p.txt', 'urgent production fix');
  git('checkout', '-q', 'production');

  for (const b of ['production', 'staging', 'develop', 'landed', 'floating', 'prodfix']) {
    git('update-ref', `refs/remotes/origin/${b}`, b);
  }
  return { dir, landingSha, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('a branch cut from production becomes a true merge, with a QC warning', () => {
  const f = branchFixture();
  try {
    const { merges, warnings, errors } = resolvePicks(f.dir, 'Vast-menu', 'X', ['prodfix']);
    assert.deepEqual(errors, []);
    assert.equal(merges.length, 1);
    assert.equal(merges[0].ref, 'origin/prodfix');
    assert.equal(merges[0].commits, 1);
    assert.match(warnings[0] ?? '', /QC has not seen them/);
  } finally {
    f.cleanup();
  }
});

test('a branch already landed on staging resolves to its landing merge commit', () => {
  const f = branchFixture();
  try {
    const { picks, merges, errors } = resolvePicks(f.dir, 'Vast-menu', 'X', ['landed']);
    assert.deepEqual(errors, []);
    assert.equal(merges.length, 0, 'must NOT be merged again');
    assert.equal(picks.length, 1);
    assert.equal(picks[0].sha, f.landingSha);
    assert.equal(picks[0].isMerge, true);
  } finally {
    f.cleanup();
  }
});

test('an unlanded branch off develop is refused with the drag count', () => {
  const f = branchFixture();
  try {
    const { errors } = resolvePicks(f.dir, 'Vast-menu', 'X', ['floating']);
    assert.match(errors[0] ?? '', /would drag 1 commit\(s\) of staging\/develop history/);
  } finally {
    f.cleanup();
  }
});

test('a missing branch names itself in the error', () => {
  const f = branchFixture();
  try {
    const { errors } = resolvePicks(f.dir, 'Vast-menu', 'X', ['no-such-thing']);
    assert.match(errors[0] ?? '', /no branch 'no-such-thing' on origin/);
  } finally {
    f.cleanup();
  }
});

test('a branch with nothing beyond production is refused as already shipped', () => {
  const f = branchFixture();
  try {
    // production itself: zero commits beyond production.
    const { errors } = resolvePicks(f.dir, 'Vast-menu', 'X', ['production']);
    assert.match(errors[0] ?? '', /already on origin\/production/);
  } finally {
    f.cleanup();
  }
});
