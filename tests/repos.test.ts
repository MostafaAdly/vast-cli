import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { REPOS, getRepo } from '../src/config/repos.js';

test('covers all ten canonical repos', () => {
  assert.equal(REPOS.length, 10);
});

test('lookup is case-insensitive but preserves canonical spelling', () => {
  assert.equal(getRepo('vastpay-dashboard')?.name, 'VastPay-DashBoard');
  assert.equal(getRepo('VASTPAYPWAV2')?.name, 'VastPayPwaV2');
});

test('unknown repo returns undefined', () => {
  assert.equal(getRepo('NotARepo'), undefined);
});

test('backend repos have no staging promotion source', () => {
  assert.equal(getRepo('VastPay-BackEnd')?.promoteFrom.staging, null);
  assert.equal(getRepo('VastMenu-BackEnd')?.promoteFrom.staging, null);
});

test('frontend repos promote into staging from develop', () => {
  assert.equal(getRepo('VastPayPwaV2')?.promoteFrom.staging, 'develop');
  assert.equal(getRepo('VastMenuPwa')?.promoteFrom.staging, 'develop');
});

// localDir is NOT derivable from name — these are the counter-examples that
// broke the original toLowerCase() assumption.
test('local checkout dirs are the real ones, not derived from the repo name', () => {
  assert.equal(getRepo('VastMenuPwa')?.localDir, 'vastmenu-pwa');
  assert.equal(getRepo('VastPayPwa')?.localDir, 'vastpay-pwa');
  assert.equal(getRepo('VastMenuPwaV2')?.localDir, 'vastmenu-pwa-v2');
  assert.equal(getRepo('vast-menu-payments')?.localDir, 'vastmenu-payments');
  assert.equal(getRepo('VastPay-BackEnd')?.localDir, 'vastpay-api');
});

test('every localDir is distinct', () => {
  const dirs = REPOS.map((r) => r.localDir);
  assert.equal(new Set(dirs).size, dirs.length);
});

// Vast-Finance has no Helm directory and no CI workflow — verified against the
// GitHub API. It must be unreleasable rather than silently attempted.
test('Vast-Finance is configured as unreleasable', () => {
  const finance = getRepo('Vast-Finance');
  assert.equal(finance?.workflow, null);
  assert.equal(finance?.helm.staging, null);
  assert.equal(finance?.helm.production, null);
});

test('every other repo has a workflow and staging Helm values', () => {
  for (const repo of REPOS.filter((r) => r.name !== 'Vast-Finance')) {
    assert.ok(repo.workflow, `${repo.name} is missing a workflow`);
    assert.ok(repo.helm.staging, `${repo.name} is missing staging Helm values`);
  }
});

// Drift guard against the reviewer manifest, the upstream source of truth for
// repo names. Skips off the author's machine rather than failing.
test('config matches vast-routines/scripts/repos.txt', (t) => {
  const manifest = join(homedir(), '.claude/vast-routines/scripts/repos.txt');
  if (!existsSync(manifest)) return t.skip('manifest not present on this machine');

  const expected = readFileSync(manifest, 'utf-8')
    .split('\n')
    .filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => l.split(':')[0])
    .sort();

  assert.deepEqual(
    REPOS.map((r) => r.name).sort(),
    expected,
  );
});
