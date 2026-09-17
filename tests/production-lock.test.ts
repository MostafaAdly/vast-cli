import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Point the lock at a throwaway directory BEFORE importing the module, so a
// failing test can never leave the real production lock lifted.
const SANDBOX = mkdtempSync(join(tmpdir(), 'vast-lock-'));
process.env.VAST_CLI_HOME = SANDBOX;

const {
  isProductionEnabled,
  enableProduction,
  disableProduction,
  enabledSince,
  lockFile,
  productionPipelineReady,
  PRODUCTION_PIPELINE_READY,
  PRODUCTION_NOT_READY_MESSAGE,
  PRODUCTION_LOCKED_MESSAGE,
  productionRefusal,
} = await import('../src/config/production-lock.js');

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

// The GitOps migration moved staging off bump PRs and onto Vast-deployments +
// ArgoCD. Production has NOT been migrated: its workflow inputs and folder
// names are assumptions. So every production deploy path is blocked by a
// constant that no file, flag or lock can lift — the file lock is the second
// gate, not the first.
test('the production pipeline is not ready, independently of the file lock', () => {
  enableProduction('2026-09-17T10:00:00Z');
  try {
    assert.equal(PRODUCTION_PIPELINE_READY, false);
    assert.equal(productionPipelineReady(), false);
  } finally {
    disableProduction();
  }
});

test('the refusal says what still works and what has to be verified first', () => {
  assert.match(PRODUCTION_NOT_READY_MESSAGE, /promote .*--to production/);
  assert.match(PRODUCTION_NOT_READY_MESSAGE, /pipeline/i);
});

// One pure gate, so every production path refuses for the same reason in the
// same order and the reason is testable without spawning a process.
test('productionRefusal never refuses staging', () => {
  assert.equal(productionRefusal('staging'), null);
  assert.equal(productionRefusal('staging', { ready: false, enabled: false }), null);
});

test('productionRefusal checks the pipeline BEFORE the lock', () => {
  // Lifting the lock must not get past the pipeline block.
  assert.equal(productionRefusal('production', { ready: false, enabled: true }), PRODUCTION_NOT_READY_MESSAGE);
});

test('productionRefusal falls through to the lock once the pipeline is ready', () => {
  assert.equal(productionRefusal('production', { ready: true, enabled: false }), PRODUCTION_LOCKED_MESSAGE);
});

test('productionRefusal allows production when ready and unlocked', () => {
  assert.equal(productionRefusal('production', { ready: true, enabled: true }), null);
});

test('productionRefusal defaults to the real pipeline and lock state', () => {
  disableProduction();
  assert.equal(productionRefusal('production'), PRODUCTION_NOT_READY_MESSAGE);
  assert.equal(productionRefusal('production', { ready: true }), PRODUCTION_LOCKED_MESSAGE);
  enableProduction('2026-09-17T10:00:00Z');
  try {
    assert.equal(productionRefusal('production', { ready: true }), null);
  } finally {
    disableProduction();
  }
});

process.on('exit', () => rmSync(SANDBOX, { recursive: true, force: true }));
