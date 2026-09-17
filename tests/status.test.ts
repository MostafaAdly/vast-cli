import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readTags } from '../src/commands/status.js';
import { getRepo } from '../src/config/repos.js';

// A production folder that does not exist yet is the normal state while
// production is unmigrated; it must not look like a read failure.
test('a deployments file that does not exist reads as not migrated', async () => {
  const tags = await readTags([getRepo('VastPayPwa')!], async (_repo, env) => {
    if (env === 'production') throw new Error('no deployments/helm/production/VastPayPwa/prod.yaml in Vast-deployments');
    return '1.5.6-rc7';
  });
  assert.deepEqual(tags.get('VastPayPwa'), { staging: '1.5.6-rc7', production: 'not migrated' });
});

test('any other read failure reads as a question mark', async () => {
  const tags = await readTags([getRepo('VastPayPwa')!], async () => {
    throw new Error('gh: connection reset');
  });
  assert.deepEqual(tags.get('VastPayPwa'), { staging: '?', production: '?' });
});

test('a repo with no file for an env reads as n/a without a read', async () => {
  let reads = 0;
  const tags = await readTags([getRepo('Terraform')!], async () => {
    reads++;
    return 'never';
  });
  assert.deepEqual(tags.get('Terraform'), { staging: 'n/a', production: 'n/a' });
  assert.equal(reads, 0);
});
