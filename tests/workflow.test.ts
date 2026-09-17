import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// workflow.ts pulls in the production lock; sandbox its home before importing
// so nothing here can read or write the real ~/.vast-cli.
const SANDBOX = mkdtempSync(join(tmpdir(), 'vast-workflow-'));
process.env.VAST_CLI_HOME = SANDBOX;

const { isProtectedBranch } = await import('../src/commands/workflow.js');
const { NEVER_PUSH } = await import('../src/utils/git.js');

test('isProtectedBranch covers every branch NEVER_PUSH covers', () => {
  for (const branch of NEVER_PUSH) {
    assert.equal(isProtectedBranch(branch), true, `${branch} must be protected`);
  }
  // master was the one NEVER_PUSH knew about and the workflow gate did not.
  assert.equal(isProtectedBranch('master'), true);
  assert.equal(isProtectedBranch('production'), true);
  assert.equal(isProtectedBranch('prod'), true);
  assert.equal(isProtectedBranch('main'), true);
});

test('isProtectedBranch trims and lowercases before matching', () => {
  assert.equal(isProtectedBranch(' Production '), true);
  assert.equal(isProtectedBranch('PRODUCTION'), true);
  assert.equal(isProtectedBranch('\tmaster\n'), true);
});

test('isProtectedBranch leaves ordinary branches alone', () => {
  assert.equal(isProtectedBranch('staging'), false);
  assert.equal(isProtectedBranch('develop'), false);
  assert.equal(isProtectedBranch('feat/gitops-staging'), false);
  assert.equal(isProtectedBranch(''), false);
});

process.on('exit', () => rmSync(SANDBOX, { recursive: true, force: true }));
