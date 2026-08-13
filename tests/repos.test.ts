import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { REPOS, getRepo, isReleasable, reposForTeam, TEAMS } from '../src/config/repos.js';

test('covers every configured repo', () => {
  assert.equal(REPOS.length, 12);
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

// The remaining exceptions are the two repos added for `vast clone` that were
// never meant to be releasable: no Helm values, no deploy workflow.
const KNOWN_UNRELEASABLE = ['Vast-Finance', 'vastpay-payment-odoo', 'Terraform'];

test('every other repo has a workflow and staging Helm values', () => {
  for (const repo of REPOS.filter((r) => !KNOWN_UNRELEASABLE.includes(r.name))) {
    assert.ok(repo.workflow, `${repo.name} is missing a workflow`);
    assert.ok(repo.helm.staging, `${repo.name} is missing staging Helm values`);
  }
});

// Drift guard against the reviewer manifest, the upstream source of truth for
// repo names. The config now deliberately exceeds the manifest (repos that
// are cloneable but not releasable), so this is a one-way containment check
// rather than an exact match. Skips off the author's machine rather than
// failing.
test('every repo in the reviewer manifest is present in the config', (t) => {
  const manifest = join(homedir(), '.claude/vast-routines/scripts/repos.txt');
  if (!existsSync(manifest)) return t.skip('manifest not present on this machine');

  const expected = readFileSync(manifest, 'utf-8')
    .split('\n')
    .filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => l.split(':')[0]);

  const names = REPOS.map((r) => r.name);
  for (const name of expected) {
    assert.ok(names.includes(name), `${name} is in repos.txt but missing from config`);
  }
});

test('every repo declares its teams', () => {
  for (const r of REPOS) {
    assert.ok(Array.isArray(r.teams), `${r.name} is missing teams`);
  }
});

test('team profiles expand to repos', () => {
  const frontend = reposForTeam('frontend').map((r) => r.name);
  assert.ok(frontend.includes('VastPayPwa'));
  assert.ok(frontend.includes('vast-menu-payments'));
  assert.ok(!frontend.includes('VastPay-BackEnd'), 'backend repo leaked into frontend');

  const backend = reposForTeam('backend').map((r) => r.name);
  assert.deepEqual(backend.sort(), ['VastMenu-BackEnd', 'VastPay-BackEnd', 'vastpay-payment-odoo']);

  assert.deepEqual(reposForTeam('infra').map((r) => r.name), ['Terraform']);
});

test('the all profile is every repo that belongs to some team', () => {
  const all = reposForTeam('all').map((r) => r.name).sort();
  const tagged = REPOS.filter((r) => r.teams.length > 0).map((r) => r.name).sort();
  assert.deepEqual(all, tagged);
});

test('an unknown team expands to nothing', () => {
  assert.deepEqual(reposForTeam('nope'), []);
});

// Releasable is derived, so cloneable-but-not-deployable repos can join the
// list without ever reaching status, promote, or deploy.
test('releasable means it has a workflow and staging Helm values', () => {
  assert.equal(isReleasable(getRepo('VastPayPwa')!), true);
  assert.equal(isReleasable(getRepo('Terraform')!), false);
  assert.equal(isReleasable(getRepo('vastpay-payment-odoo')!), false);
  assert.equal(isReleasable(getRepo('Vast-Finance')!), false);
});

test('the ten original repos are still the releasable set', () => {
  assert.equal(REPOS.filter(isReleasable).length, 9, 'Vast-Finance has no workflow or Helm');
});

test('TEAMS lists the profiles offered', () => {
  assert.deepEqual(TEAMS.sort(), ['all', 'backend', 'frontend', 'infra']);
});
