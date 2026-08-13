import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deployTargets } from '../src/commands/deploy.js';

// Regression: `vast deploy --all` must never include an unreleasable repo.
// It previously iterated the raw REPOS list, so an unreleasable repo
// (Terraform, vastpay-payment-odoo, Vast-Finance) that simply was not cloned
// yet produced a 'failed' outcome and took process.exit(1) down with it.
test('--all targets only releasable repos', () => {
  const names = deployTargets(undefined, true).map((r) => r.name);
  assert.ok(!names.includes('Terraform'), 'Terraform is not releasable and must not be a target');
  assert.ok(
    !names.includes('vastpay-payment-odoo'),
    'vastpay-payment-odoo is not releasable and must not be a target',
  );
  assert.ok(!names.includes('Vast-Finance'), 'Vast-Finance is not releasable and must not be a target');
  assert.ok(names.includes('VastPayPwa'), 'a releasable repo must still be a target');
});

test('a named repo is targeted regardless of releasability', () => {
  // Explicit single-repo targeting is unfiltered — only the --all sweep is
  // scoped to releasable repos, since a direct `vast deploy Terraform` should
  // still surface "no deploy workflow exists" rather than "unknown repository".
  const names = deployTargets('Terraform', false).map((r) => r.name);
  assert.deepEqual(names, ['Terraform']);
});

test('an unknown repo name targets nothing', () => {
  assert.deepEqual(deployTargets('NotARepo', false), []);
});
