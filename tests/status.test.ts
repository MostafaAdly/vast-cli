import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readTags } from '../src/commands/status.js';
import { getRepo } from '../src/config/repos.js';
import type { ProductionTagSource } from '../src/utils/deployments.js';

const dirs = (name: string, dir: string | null): Map<string, string | null> => new Map([[name, dir]]);

const fromDeployments = (tag: string): ProductionTagSource => ({ tag, source: 'vast-deployments' });
const fromAppRepo = (tag: string): ProductionTagSource => ({ tag, source: 'app-repo' });

// A production folder that does not exist yet is the normal state while
// production is unmigrated; it must not look like a read failure.
test('a deployments file that does not exist reads as not migrated', async () => {
  const tags = await readTags(
    [getRepo('VastPayPwa')!],
    dirs('VastPayPwa', null),
    async () => '1.5.6-rc7',
    async () => {
      throw new Error(
        'no deployments/helm/production/VastPayPwa/prod.yaml in Vast-deployments, and no Helm/values-prod.yaml on origin/production (VastPayPwa is not cloned)',
      );
    },
  );
  assert.deepEqual(tags.get('VastPayPwa'), {
    staging: '1.5.6-rc7',
    production: 'not migrated',
    productionFromAppRepo: false,
  });
});

test('any other read failure reads as a question mark', async () => {
  const tags = await readTags(
    [getRepo('VastPayPwa')!],
    dirs('VastPayPwa', '/repo'),
    async () => {
      throw new Error('gh: connection reset');
    },
    async () => {
      throw new Error('gh: connection reset');
    },
  );
  assert.deepEqual(tags.get('VastPayPwa'), {
    staging: '?',
    production: '?',
    productionFromAppRepo: false,
  });
});

test('a repo with no file for an env reads as n/a without a read', async () => {
  let reads = 0;
  const tags = await readTags(
    [getRepo('Terraform')!],
    dirs('Terraform', '/repo'),
    async () => {
      reads++;
      return 'never';
    },
    async () => {
      reads++;
      return fromDeployments('never');
    },
  );
  assert.deepEqual(tags.get('Terraform'), {
    staging: 'n/a',
    production: 'n/a',
    productionFromAppRepo: false,
  });
  assert.equal(reads, 0);
});

test('a production tag from Vast-deployments is not flagged', async () => {
  const tags = await readTags(
    [getRepo('VastPayPwa')!],
    dirs('VastPayPwa', '/repo'),
    async () => '1.5.6-rc7',
    async () => fromDeployments('1.5.6'),
  );
  assert.deepEqual(tags.get('VastPayPwa'), {
    staging: '1.5.6-rc7',
    production: '1.5.6',
    productionFromAppRepo: false,
  });
});

test('a production tag read from the app repo Helm is flagged', async () => {
  const seen: (string | null)[] = [];
  const tags = await readTags(
    [getRepo('VastPayPwa')!],
    dirs('VastPayPwa', '/repo'),
    async () => '1.5.6-rc7',
    async (_repo, dir) => {
      seen.push(dir);
      return fromAppRepo('1.5.5');
    },
  );
  assert.deepEqual(tags.get('VastPayPwa'), {
    staging: '1.5.6-rc7',
    production: '1.5.5',
    productionFromAppRepo: true,
  });
  assert.deepEqual(seen, ['/repo']);
});
