import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkAgainstProduction, guardStagingVersion } from '../src/utils/version-guard.js';
import { getRepo, type RepoConfig } from '../src/config/repos.js';

const repo = getRepo('VastMenu-DashBoard') as RepoConfig;

// --- the pure comparison ---

test('a candidate above production is clear', () => {
  assert.deepEqual(checkAgainstProduction('2.1.34-rc1', '2.1.33'), { kind: 'clear' });
  assert.deepEqual(checkAgainstProduction('2.2.0-rc1', '2.1.33'), { kind: 'clear' });
  assert.deepEqual(checkAgainstProduction('3.0.0-rc1', '2.9.9'), { kind: 'clear' });
});

// Shaped like 2026-10-01: VastMenu-DashBoard staging 2.1.12-rc30, production
// in the 2.1.3x range after a run of hotfixes. Continuing the series would later
// ship release/2.1.12 on top of it.
test('a candidate below production is behind, corrected past production', () => {
  assert.deepEqual(checkAgainstProduction('2.1.12-rc31', '2.1.33'), {
    kind: 'behind',
    production: '2.1.33',
    corrected: '2.1.34-rc1',
  });
  assert.deepEqual(checkAgainstProduction('1.9.0-rc4', '2.0.0'), {
    kind: 'behind',
    production: '2.0.0',
    corrected: '2.0.1-rc1',
  });
});

// Equal is as bad as lower: release/2.1.14 would collide with the live 2.1.14.
test('a candidate equal to production is behind', () => {
  assert.deepEqual(checkAgainstProduction('2.1.14-rc1', '2.1.14'), {
    kind: 'behind',
    production: '2.1.14',
    corrected: '2.1.15-rc1',
  });
});

test('only X.Y.Z counts — rc numbers never rescue a lower base', () => {
  assert.equal(checkAgainstProduction('2.1.33-rc99', '2.1.33').kind, 'behind');
});

// --- the guard around it ---

const prod = (tag: string) => async () => tag;
const unreadable = async (): Promise<string> => {
  throw new Error('no deployments/helm/production/x/prod.yaml in Vast-deployments');
};

test('clear: the candidate goes through untouched, no notice', async () => {
  const r = await guardStagingVersion(repo, null, '2.1.34-rc1', { explicit: false, fixVersion: false }, prod('2.1.33'));
  assert.deepEqual(r, { ok: true, version: '2.1.34-rc1' });
});

test('behind: refused by default, naming production and both ways out', async () => {
  const r = await guardStagingVersion(repo, null, '2.1.12-rc31', { explicit: false, fixVersion: false }, prod('2.1.33'));
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.detail, /2\.1\.12-rc31 is not above production 2\.1\.33/);
  assert.match(r.detail, /--fix-version/);
  assert.match(r.detail, /2\.1\.34-rc1/);
});

test('behind with --fix-version: auto-corrected, and it says so', async () => {
  const r = await guardStagingVersion(repo, null, '2.1.12-rc31', { explicit: false, fixVersion: true }, prod('2.1.33'));
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.version, '2.1.34-rc1');
  assert.equal(r.notice?.tone, 'warn');
  assert.match(r.notice?.text ?? '', /auto-corrected 2\.1\.12-rc31 → 2\.1\.34-rc1 \(production is 2\.1\.33\)/);
});

// -v is a deliberate choice, so it is warned about, never refused or rewritten.
test('behind with an explicit version: shipped as given, with a warning', async () => {
  const r = await guardStagingVersion(repo, null, '2.1.12-rc31', { explicit: true, fixVersion: false }, prod('2.1.33'));
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.version, '2.1.12-rc31');
  assert.equal(r.notice?.tone, 'warn');
  assert.match(r.notice?.text ?? '', /not above production 2\.1\.33/);
});

// Missing data never blocks a release that used to work.
test('production unreadable: the candidate goes through with a muted note', async () => {
  const r = await guardStagingVersion(repo, null, '2.1.12-rc31', { explicit: false, fixVersion: false }, unreadable);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.version, '2.1.12-rc31');
  assert.equal(r.notice?.tone, 'muted');
  assert.match(r.notice?.text ?? '', /not checked against production/);
});

test('production tag unparseable: same as unreadable', async () => {
  const r = await guardStagingVersion(repo, null, '2.1.12-rc31', { explicit: false, fixVersion: false }, prod('latest'));
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.notice?.tone, 'muted');
});
