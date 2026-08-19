import { test } from 'node:test';
import assert from 'node:assert/strict';
import { releaseTargets } from '../src/commands/release.js';
import { notClonedOutcome } from '../src/commands/deploy.js';

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

// `vast release --all` shares deploy's outcome shape, and the same rule: a
// releasable repo you were never meant to have is skipped, not failed, so a
// frontend teammate's sweep does not exit 1 over the backend repos.
test('an uncloned repo is skipped during a sweep, not failed', () => {
  assert.equal(notClonedOutcome('VastMenu-BackEnd', true).status, 'skipped');
});

test('an uncloned repo the user named explicitly is a failure', () => {
  assert.equal(notClonedOutcome('VastMenu-BackEnd', false).status, 'failed');
});

// The backends have no usable develop; failing their release for a promotion
// that cannot exist made `vast release <backend>` unusable and turned every
// `release --all` sweep red on any machine with backend checkouts.
test('release skips promotion for repos with no develop, and only those', async () => {
  const { needsPromotion } = await import('../src/commands/release.js');
  const { getRepo } = await import('../src/config/repos.js');
  assert.equal(needsPromotion(getRepo('VastPay-BackEnd')!), false);
  assert.equal(needsPromotion(getRepo('VastMenu-BackEnd')!), false);
  assert.equal(needsPromotion(getRepo('VastPayPwa')!), true);
  assert.equal(needsPromotion(getRepo('vast-menu-payments')!), true);
});
