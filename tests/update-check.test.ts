import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SANDBOX = mkdtempSync(join(tmpdir(), 'vast-upd-'));
process.env.VAST_CLI_HOME = SANDBOX;

const { isDue, normalize, pendingHint, readState } = await import('../src/utils/update-check.js');

const DAY = 24 * 60 * 60 * 1000;

function writeCache(state: unknown): void {
  mkdirSync(SANDBOX, { recursive: true });
  writeFileSync(join(SANDBOX, 'update-check.json'), JSON.stringify(state), 'utf-8');
}

test('a version with a leading v compares equal to one without', () => {
  assert.equal(normalize('v1.2.0'), '1.2.0');
  assert.equal(normalize('1.2.0'), '1.2.0');
  assert.equal(normalize('  v1.2.0  '), '1.2.0');
});

test('a check is due when none has ever run', () => {
  assert.equal(isDue(null, Date.now()), true);
});

test('a check is not due again within the day', () => {
  const now = Date.now();
  assert.equal(isDue({ checkedAt: now, latest: 'v1.0.0' }, now + DAY - 1000), false);
});

test('a check is due once the day has passed', () => {
  const now = Date.now();
  assert.equal(isDue({ checkedAt: now, latest: 'v1.0.0' }, now + DAY + 1000), true);
});

// A failed check still records the attempt, so a machine with no network does
// not re-check on every single command.
test('a failed check still counts as having run', () => {
  const now = Date.now();
  assert.equal(isDue({ checkedAt: now, latest: null }, now + 1000), false);
});

test('no hint when the cached latest matches the running version', () => {
  writeCache({ checkedAt: Date.now(), latest: 'v1.0.0' });
  assert.equal(pendingHint('1.0.0'), null);
});

test('hint when a newer version is cached', () => {
  writeCache({ checkedAt: Date.now(), latest: 'v1.4.0' });
  const hint = pendingHint('1.0.0');
  assert.match(hint ?? '', /1\.4\.0/);
  assert.match(hint ?? '', /vast upgrade/);
});

test('no hint when the check has never succeeded', () => {
  writeCache({ checkedAt: Date.now(), latest: null });
  assert.equal(pendingHint('1.0.0'), null);
});

test('no hint and no throw when there is no cache at all', () => {
  rmSync(join(SANDBOX, 'update-check.json'), { force: true });
  assert.equal(readState(), null);
  assert.equal(pendingHint('1.0.0'), null);
});

// A hand-edited or truncated cache must not break every command.
test('a corrupt cache degrades to no hint', () => {
  writeFileSync(join(SANDBOX, 'update-check.json'), '{ not json', 'utf-8');
  assert.equal(readState(), null);
  assert.equal(pendingHint('1.0.0'), null);
});

process.on('exit', () => rmSync(SANDBOX, { recursive: true, force: true }));

// Observed live: right after upgrading to 1.3.0 the day-old cache still said
// 1.2.1, and a plain inequality produced
// "A newer Vast CLI is available (1.2.1, you have 1.3.0)" — telling the user to
// upgrade backwards.
test('no hint when the cached release is older than what is installed', () => {
  writeCache({ checkedAt: Date.now(), latest: 'v1.2.1' });
  assert.equal(pendingHint('1.3.0'), null);
});

test('isNewer compares numerically, not lexically', async () => {
  const { isNewer } = await import('../src/utils/update-check.js');
  assert.equal(isNewer('1.10.0', '1.9.0'), true, '10 > 9 numerically');
  assert.equal(isNewer('1.9.0', '1.10.0'), false);
  assert.equal(isNewer('2.0.0', '1.99.99'), true);
  assert.equal(isNewer('1.2.3', '1.2.3'), false);
  assert.equal(isNewer('v1.3.0', '1.2.1'), true, 'leading v must not matter');
});

test('a shorter version string still compares correctly', async () => {
  const { isNewer } = await import('../src/utils/update-check.js');
  assert.equal(isNewer('1.3', '1.2.9'), true);
  assert.equal(isNewer('1.2', '1.2.0'), false);
});
