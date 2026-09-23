import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isBumpBranch, isPipelineNoise, isVehicleBranch, parsePrSubject } from '../src/utils/pr-subject.js';

test('a PR merge subject gives the number and the branch without its owner', () => {
  assert.deepEqual(parsePrSubject('Merge pull request #328 from Vast-Menu/refactor/rely-on-code'), {
    number: 328,
    branch: 'refactor/rely-on-code',
  });
});

test('a subject with no owner keeps the whole branch', () => {
  assert.deepEqual(parsePrSubject('Merge pull request #5 from feature'), { number: 5, branch: 'feature' });
});

test('anything that is not a PR merge subject is not a PR', () => {
  assert.equal(parsePrSubject('fix: detect cancelled orders'), null);
  assert.equal(parsePrSubject("Merge branch 'develop' into staging"), null);
});

test('the CI bump branches are bumps', () => {
  assert.equal(isBumpBranch('bump-stage-1.0.0-rc1'), true);
  assert.equal(isBumpBranch('bump-prod-2.1.14'), true);
  assert.equal(isBumpBranch('fix/bump-stage-typo'), false);
});

test('release, hotfix and bump PRs are vehicles; work branches are not', () => {
  assert.equal(isVehicleBranch('release/2.1.10'), true);
  assert.equal(isVehicleBranch('hotfix/2.1.15'), true);
  assert.equal(isVehicleBranch('bump-prod-2.1.14'), true);
  assert.equal(isVehicleBranch('feat/x'), false);
  assert.equal(isVehicleBranch('fix/release-notes'), false);
});

test('CI bookkeeping and merge subjects are pipeline noise', () => {
  assert.equal(isPipelineNoise('chore: bump version to 2.1.14'), true);
  assert.equal(isPipelineNoise('chore: align package.json version'), true);
  assert.equal(isPipelineNoise("Merge branch 'develop' into staging"), true);
  assert.equal(isPipelineNoise("Merge remote-tracking branch 'origin/develop'"), true);
  assert.equal(isPipelineNoise('Merge pull request #1 from Vast-Menu/x'), true);
  assert.equal(isPipelineNoise('fix(pwa): preserve disabled plugin lifecycle'), false);
});
