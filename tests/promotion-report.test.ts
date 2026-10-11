import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { VastEvent } from '../src/utils/events.js';

process.env.VAST_CLI_HOME = mkdtempSync(join(tmpdir(), 'vast-report-home-'));
const { promote } = await import('../src/commands/promote.js');
const { runPromote } = await import('../src/commands/promote.js');
const { newReport } = await import('../src/utils/promotion-report.js');
const { getRepo } = await import('../src/config/repos.js');

/** A clone with a real origin holding develop, staging and production. */
function fixture(developAhead: number): { clone: string; cleanup: () => void } {
  const base = mkdtempSync(join(tmpdir(), 'vast-report-'));
  const upstream = join(base, 'upstream');
  const clone = join(base, 'clone');
  const git = (dir: string, ...args: string[]): string =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf-8', stdio: 'pipe' });
  execFileSync('git', ['init', '-q', '-b', 'production', upstream], { stdio: 'pipe' });
  git(upstream, 'config', 'user.email', 't@e.com');
  git(upstream, 'config', 'user.name', 'T');
  writeFileSync(join(upstream, 'f.txt'), 'base\n');
  git(upstream, 'add', '.');
  git(upstream, 'commit', '-qm', 'base');
  git(upstream, 'branch', 'staging');
  git(upstream, 'checkout', '-qb', 'develop');
  for (let i = 0; i < developAhead; i++) {
    writeFileSync(join(upstream, `d${i}.txt`), `${i}\n`);
    git(upstream, 'add', '.');
    git(upstream, 'commit', '-qm', `feat: d${i}`);
  }
  git(upstream, 'checkout', '-q', 'production');
  execFileSync('git', ['clone', '-q', upstream, clone], { stdio: 'pipe' });
  git(clone, 'config', 'user.email', 't@e.com');
  git(clone, 'config', 'user.name', 'T');
  return { clone, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

const REPO = getRepo('VastPayPwa')!;

test('a dry-run staging promotion reports the commits it would merge', async () => {
  const f = fixture(2);
  try {
    const report = newReport();
    assert.equal(await promote(REPO, f.clone, 'staging', true, 'release', undefined, 'changelog', [], false, report), true);
    assert.deepEqual(report, { commits: 2, result: 'would merge' });
  } finally {
    f.cleanup();
  }
});

test('a staging promotion with nothing new reports nothing to promote', async () => {
  const f = fixture(0);
  try {
    const report = newReport();
    assert.equal(await promote(REPO, f.clone, 'staging', true, 'release', undefined, 'changelog', [], false, report), true);
    assert.deepEqual(report, { commits: 0, result: 'nothing to promote' });
  } finally {
    f.cleanup();
  }
});

test('a refused promotion records why', async () => {
  const f = fixture(1);
  try {
    writeFileSync(join(f.clone, 'dirty.txt'), 'uncommitted\n');
    const report = newReport();
    assert.equal(await promote(REPO, f.clone, 'staging', true, 'release', undefined, 'changelog', [], false, report), false);
    assert.equal(report.result, 'refused');
    assert.equal(report.error, 'VastPayPwa has uncommitted changes');
  } finally {
    f.cleanup();
  }
});

const BASE_OPTS = { to: 'staging', changelog: true, dryRun: true } as const;

test('runPromote brackets a promotion with start, plan and done', async () => {
  const f = fixture(2);
  try {
    const seen: VastEvent[] = [];
    const code = await runPromote('VastPayPwa', { ...BASE_OPTS, dir: f.clone }, { emit: (e) => seen.push(e) }, [
      'promote',
      'VastPayPwa',
      '--dry-run',
      '--json',
    ]);
    assert.equal(code, 0);
    assert.deepEqual(seen.map((e) => e.type), ['start', 'plan', 'done']);
    assert.deepEqual(seen[1], {
      type: 'plan',
      repo: 'VastPayPwa',
      ok: true,
      version: '—',
      commits: 2,
      promote: 'will merge',
      notice: null,
      detail: null,
    });
    assert.deepEqual(seen[2], { type: 'done', repo: 'VastPayPwa', version: '—', status: 'skipped', detail: 'dry run' });
  } finally {
    f.cleanup();
  }
});

test('runPromote on an unknown repository is exit 1 with no events', async () => {
  const seen: VastEvent[] = [];
  assert.equal(await runPromote('Nope', BASE_OPTS, { emit: (e) => seen.push(e) }, ['promote', 'Nope']), 1);
  assert.deepEqual(seen, []);
});

test('a refused promotion is done/failed with the reason', async () => {
  const f = fixture(1);
  try {
    writeFileSync(join(f.clone, 'dirty.txt'), 'x\n');
    const seen: VastEvent[] = [];
    const code = await runPromote('VastPayPwa', { ...BASE_OPTS, dir: f.clone }, { emit: (e) => seen.push(e) }, []);
    assert.equal(code, 1);
    assert.deepEqual(seen.at(-1), {
      type: 'done',
      repo: 'VastPayPwa',
      version: '—',
      status: 'failed',
      detail: 'VastPayPwa has uncommitted changes',
    });
  } finally {
    f.cleanup();
  }
});
