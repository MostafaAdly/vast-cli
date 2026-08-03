import { test } from 'node:test';
import assert from 'node:assert/strict';
import { releaseBranchName, RELEASE_KINDS } from '../src/utils/release-branch.js';

test('names a release branch after the finalised version', () => {
  assert.equal(releaseBranchName('release', '2.1.0'), 'release/2.1.0');
});

test('names a hotfix branch the same way', () => {
  assert.equal(releaseBranchName('hotfix', '2.0.13'), 'hotfix/2.0.13');
});

// The staging tag is what gets passed in, so the suffix must be dropped —
// `release/2.1.0-rc45` would be wrong. Matches the branches in shell history:
// release/2.1.0 was cut while staging ran 2.1.0-rc45.
test('strips the candidate suffix from the branch name', () => {
  assert.equal(releaseBranchName('release', '2.1.0-rc45'), 'release/2.1.0');
  assert.equal(releaseBranchName('hotfix', '1.5.5-rc15'), 'hotfix/1.5.5');
});

test('zero-padded candidates still yield a clean branch name', () => {
  assert.equal(releaseBranchName('release', '1.6.9-rc03'), 'release/1.6.9');
});

test('both kinds are offered', () => {
  assert.deepEqual(RELEASE_KINDS, ['release', 'hotfix']);
});
