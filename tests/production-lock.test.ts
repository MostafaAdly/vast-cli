import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Point the lock at a throwaway directory BEFORE importing the module, so a
// failing test can never leave the real production lock lifted.
const SANDBOX = mkdtempSync(join(tmpdir(), 'vast-lock-'));
process.env.VAST_CLI_HOME = SANDBOX;

const { isProductionEnabled, enableProduction, disableProduction, enabledSince, lockFile } =
  await import('../src/config/production-lock.js');

test('the lock file lives under VAST_CLI_HOME when set', () => {
  assert.equal(lockFile(), join(SANDBOX, 'production-enabled'));
});

test('production is disabled by default', () => {
  disableProduction();
  assert.equal(isProductionEnabled(), false);
  assert.equal(enabledSince(), null);
});

test('enable lifts the lock and records when', () => {
  disableProduction();
  enableProduction('2026-08-04T10:00:00Z');
  assert.equal(isProductionEnabled(), true);
  assert.equal(enabledSince(), '2026-08-04T10:00:00Z');
});

test('disable puts it back', () => {
  enableProduction('2026-08-04T10:00:00Z');
  disableProduction();
  assert.equal(isProductionEnabled(), false);
});

test('disable is idempotent', () => {
  disableProduction();
  disableProduction();
  assert.equal(isProductionEnabled(), false);
});

process.on('exit', () => rmSync(SANDBOX, { recursive: true, force: true }));
