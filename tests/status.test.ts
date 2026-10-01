import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readTags } from '../src/commands/status.js';
import { getRepo } from '../src/config/repos.js';
import type { DeployEnv } from '../src/config/repos.js';

/** A reader answering per environment, like deployedTag does. */
const byEnv =
  (answers: Record<DeployEnv, () => Promise<string>>) =>
  async (_repo: unknown, env: DeployEnv): Promise<string> =>
    answers[env]();

// A folder nobody has created yet must not look like a read failure.
test('a deployments file that does not exist reads as not migrated', async () => {
  const tags = await readTags(
    [getRepo('VastPayPwa')!],
    byEnv({
      staging: async () => '1.5.6-rc7',
      production: async () => {
        throw new Error('no deployments/helm/production/vastpay-pwa/prod.yaml in Vast-deployments');
      },
    }),
  );
  assert.deepEqual(tags.get('VastPayPwa'), { staging: '1.5.6-rc7', production: 'not migrated' });
});

test('any other read failure reads as a question mark', async () => {
  const fail = async (): Promise<string> => {
    throw new Error('gh: connection reset');
  };
  const tags = await readTags([getRepo('VastPayPwa')!], byEnv({ staging: fail, production: fail }));
  assert.deepEqual(tags.get('VastPayPwa'), { staging: '?', production: '?' });
});

test('a repo with no file for an env reads as n/a without a read', async () => {
  let reads = 0;
  const count = async (): Promise<string> => {
    reads++;
    return 'never';
  };
  const tags = await readTags([getRepo('Terraform')!], byEnv({ staging: count, production: count }));
  assert.deepEqual(tags.get('Terraform'), { staging: 'n/a', production: 'n/a' });
  assert.equal(reads, 0);
});

test('both tags come from Vast-deployments, one read per environment', async () => {
  const seen: DeployEnv[] = [];
  const tags = await readTags([getRepo('VastPayPwa')!], async (_repo, env) => {
    seen.push(env);
    return env === 'staging' ? '1.5.6-rc7' : '1.5.6';
  });
  assert.deepEqual(tags.get('VastPayPwa'), { staging: '1.5.6-rc7', production: '1.5.6' });
  assert.deepEqual(seen.sort(), ['production', 'staging']);
});
