import { test } from 'node:test';
import assert from 'node:assert/strict';
import { releaseTargets } from '../src/commands/release.js';

// Regression: `vast release --all` must never include an unreleasable repo.
// It previously iterated the raw REPOS list, so an unreleasable repo
// (Terraform, vastpay-payment-odoo, Vast-Finance) that simply was not cloned
// yet produced a 'failed' outcome and took process.exit(1) down with it.
test('--all targets only releasable repos', () => {
  const names = releaseTargets(undefined, true).map((r) => r.name);
  assert.ok(!names.includes('Terraform'), 'Terraform is not releasable and must not be a target');
  assert.ok(
    !names.includes('vastpay-payment-odoo'),
    'vastpay-payment-odoo is not releasable and must not be a target',
  );
  assert.ok(!names.includes('Vast-Finance'), 'Vast-Finance is not releasable and must not be a target');
  assert.ok(names.includes('VastPayPwa'), 'a releasable repo must still be a target');
});

test('a named repo is targeted regardless of releasability', () => {
  const names = releaseTargets('Terraform', false).map((r) => r.name);
  assert.deepEqual(names, ['Terraform']);
});

test('an unknown repo name targets nothing', () => {
  assert.deepEqual(releaseTargets('NotARepo', false), []);
});
