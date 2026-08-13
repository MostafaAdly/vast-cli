import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deployTargets, notClonedOutcome } from '../src/commands/deploy.js';

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

// Filtering `--all` to releasable repos fixed the instance, not the class: a
// repo that IS releasable but simply is not on this machine still failed the
// sweep and took exit 1 with it. A frontend teammate running `vast deploy --all`
// has no backend checkouts, and that is the normal state on a portable CLI.
test('an uncloned repo is skipped during a sweep, not failed', () => {
  assert.equal(notClonedOutcome('VastPay-BackEnd', true).status, 'skipped');
});

test('an uncloned repo the user named explicitly is a failure', () => {
  assert.equal(notClonedOutcome('VastPay-BackEnd', false).status, 'failed');
});

test('either way the outcome says the repo is not cloned', () => {
  for (const all of [true, false]) {
    const outcome = notClonedOutcome('VastPay-BackEnd', all);
    assert.equal(outcome.repo, 'VastPay-BackEnd');
    assert.match(outcome.detail, /not cloned/);
    assert.match(outcome.detail, /vast clone/);
  }
});
