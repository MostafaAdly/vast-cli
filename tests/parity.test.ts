import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compareBranches } from '../src/utils/parity.js';

/**
 * Real repos with real merges: PR membership, cherry-picked merges and
 * patch-ids are all properties of the commit graph, so a mock would test
 * nothing.
 */
function repo(): { dir: string; git: (...args: string[]) => string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'vast-parity-'));
  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf-8', stdio: 'pipe' }).trim();
  git('init', '-q', '-b', 'production');
  git('config', 'user.email', 't@e.com');
  git('config', 'user.name', 'T');
  writeFileSync(join(dir, 'f.txt'), 'base\n');
  writeFileSync(join(dir, 'package.json'), '{\n  "name": "x",\n  "version": "1.0.0"\n}\n');
  git('add', '.');
  git('commit', '-qm', 'base');
  return { dir, git, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function write(dir: string, file: string, content: string): void {
  mkdirSync(join(dir, file, '..'), { recursive: true });
  writeFileSync(join(dir, file), content);
}

/** Commit one file on a new branch off `onto`, merge it back --no-ff; returns the branch tip. */
function mergePr(
  r: ReturnType<typeof repo>,
  onto: string,
  number: number,
  branch: string,
  file: string,
  content = `${file}\n`,
): string {
  r.git('checkout', '-q', onto);
  r.git('checkout', '-qb', branch);
  write(r.dir, file, content);
  r.git('add', '.');
  r.git('commit', '-qm', `feat: ${file}`);
  const tip = r.git('rev-parse', 'HEAD');
  r.git('checkout', '-q', onto);
  r.git('merge', '-q', '--no-ff', '-m', `Merge pull request #${number} from Vast-Menu/${branch}`, branch);
  return tip;
}

function commit(r: ReturnType<typeof repo>, on: string, file: string, content: string, subject: string): void {
  r.git('checkout', '-q', on);
  write(r.dir, file, content);
  r.git('add', '.');
  r.git('commit', '-qm', subject);
}

const numbers = (prs: { number: number }[]): number[] => prs.map((p) => p.number);
const subjects = (cs: { subject: string }[]): string[] => cs.map((c) => c.subject).sort();

test('staging vs production: PRs by number, vehicles and noise dropped, ports found by code', () => {
  const r = repo();
  try {
    r.git('checkout', '-qb', 'staging');
    mergePr(r, 'staging', 10, 'feat/a', 'a.txt');
    mergePr(r, 'staging', 11, 'fix/b', 'b.txt');
    const pr11 = r.git('rev-parse', 'staging');
    commit(r, 'staging', 'd.txt', 'd\n', 'fix: direct on staging');
    commit(r, 'staging', 'package.json', '{\n  "name": "x",\n  "version": "1.0.1-rc2"\n}\n', 'ci: version 1.0.1-rc2');
    commit(r, 'staging', 'Helm/values-stage.yaml', 'tag: x\n', 'Update values-stage.yaml');

    // Production: #11 arrives as a cherry-picked merge, as a --pick hotfix carries it.
    r.git('checkout', '-q', 'production');
    r.git('cherry-pick', '-m', '1', pr11);
    // A hotfix vehicle carrying a version bump and one fix made on the hotfix branch itself.
    r.git('checkout', '-qb', 'hotfix/1.0.1');
    write(r.dir, 'package.json', '{\n  "name": "x",\n  "version": "1.0.1"\n}\n');
    r.git('commit', '-qam', 'ci: version 1.0.1');
    write(r.dir, 'h.txt', 'h\n');
    r.git('add', '.');
    r.git('commit', '-qm', 'fix: hotfix-only change');
    r.git('checkout', '-q', 'production');
    r.git('merge', '-q', '--no-ff', '-m', 'Merge pull request #20 from Vast-Menu/hotfix/1.0.1', 'hotfix/1.0.1');
    const cTip = mergePr(r, 'production', 30, 'fix/c', 'c.txt');
    mergePr(r, 'production', 31, 'fix/e', 'e.txt', 'e1\n');

    // Ported back to staging: #30 cleanly (same code), #31 by hand with different code.
    r.git('checkout', '-q', 'staging');
    r.git('cherry-pick', cTip);
    commit(r, 'staging', 'e.txt', 'e2\n', 'fix: port e by hand');

    const p = compareBranches(r.dir, 'staging', 'production');

    assert.deepEqual(p.sharedPrs, [11]);
    assert.deepEqual(numbers(p.onlySource.prs), [10]);
    assert.deepEqual(subjects(p.onlySource.direct), ['feat: c.txt', 'fix: direct on staging', 'fix: port e by hand']);
    assert.deepEqual(numbers(p.onlyTarget.prs), [30, 31]);
    assert.deepEqual(subjects(p.onlyTarget.direct), ['fix: hotfix-only change']);

    const portC = p.onlySource.direct.find((c) => c.subject === 'feat: c.txt')!;
    const portE = p.onlySource.direct.find((c) => c.subject === 'fix: port e by hand')!;
    const pr30 = p.onlyTarget.prs.find((u) => u.number === 30)!;
    const pr31 = p.onlyTarget.prs.find((u) => u.number === 31)!;
    assert.equal(p.onlySource.ported.has(portC.sha), true);
    assert.equal(p.onlyTarget.ported.has(pr30.sha), true);
    assert.equal(p.onlySource.ported.has(portE.sha), false);
    assert.equal(p.onlyTarget.ported.has(pr31.sha), false);
  } finally {
    r.cleanup();
  }
});

test('develop vs staging: a promote merge carries PRs, and their commits are not direct commits', () => {
  const r = repo();
  try {
    r.git('checkout', '-qb', 'staging');
    r.git('checkout', '-qb', 'develop');
    mergePr(r, 'develop', 40, 'feat/p', 'p.txt');
    r.git('checkout', '-q', 'staging');
    r.git('merge', '-q', '--no-ff', '-m', "Merge branch 'develop' into staging", 'develop');
    mergePr(r, 'develop', 41, 'feat/q', 'q.txt');
    commit(r, 'staging', 's.txt', 's\n', 'fix: hotfix on staging');

    const promote = compareBranches(r.dir, 'develop', 'staging');
    assert.deepEqual(numbers(promote.onlySource.prs), [41]);
    assert.deepEqual(promote.onlySource.direct, []);
    assert.deepEqual(numbers(promote.onlyTarget.prs), []);
    assert.deepEqual(subjects(promote.onlyTarget.direct), ['fix: hotfix on staging']);

    const release = compareBranches(r.dir, 'staging', 'production');
    assert.deepEqual(numbers(release.onlySource.prs), [40]);
    assert.deepEqual(subjects(release.onlySource.direct), ['fix: hotfix on staging']);
  } finally {
    r.cleanup();
  }
});

test('a PR lands when its merge was committed', () => {
  const r = repo();
  try {
    r.git('checkout', '-qb', 'staging');
    r.git('checkout', '-qb', 'feat/t');
    write(r.dir, 't.txt', 't\n');
    r.git('add', '.');
    r.git('commit', '-qm', 'feat: t');
    r.git('checkout', '-q', 'staging');
    execFileSync('git', ['merge', '-q', '--no-ff', '-m', 'Merge pull request #50 from Vast-Menu/feat/t', 'feat/t'], {
      cwd: r.dir,
      stdio: 'pipe',
      env: { ...process.env, GIT_COMMITTER_DATE: '2026-09-01T00:00:00Z' },
    });
    const p = compareBranches(r.dir, 'staging', 'production');
    assert.equal(p.onlySource.prs[0].landedAt.toISOString(), '2026-09-01T00:00:00.000Z');
  } finally {
    r.cleanup();
  }
});

test('identical branches compare empty', () => {
  const r = repo();
  try {
    r.git('checkout', '-qb', 'staging');
    const p = compareBranches(r.dir, 'staging', 'production');
    assert.deepEqual(p.onlySource.prs, []);
    assert.deepEqual(p.onlySource.direct, []);
    assert.deepEqual(p.onlyTarget.prs, []);
    assert.deepEqual(p.sharedPrs, []);
  } finally {
    r.cleanup();
  }
});

test('an unknown ref throws rather than reporting an empty difference', () => {
  const r = repo();
  try {
    assert.throws(() => compareBranches(r.dir, 'origin/nope', 'production'));
  } finally {
    r.cleanup();
  }
});
