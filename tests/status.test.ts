import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readTags, statusJson, type Row } from '../src/commands/status.js';
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

const row = (over: Partial<Row>): Row => ({
  name: 'VastPayPwaV2',
  staging: '2.1.4-rc1',
  production: '2.1.17',
  drift: 'develop +10',
  ...over,
});

test('status JSON carries versions, team, display name and drift ahead', () => {
  const json = statusJson([getRepo('VastPayPwaV2')!], [row({})], new Date('2026-10-11T09:00:00.000Z'));
  assert.deepEqual(json, {
    generatedAt: '2026-10-11T09:00:00.000Z',
    repos: [
      {
        repo: 'VastPayPwaV2',
        displayName: 'Vastpay Pwa V2',
        releaseTeam: 'frontend',
        staging: { tag: '2.1.4-rc1', problem: null },
        production: { tag: '2.1.17', problem: null },
        drift: { text: 'develop +10', ahead: 10, problem: null },
      },
    ],
  });
});

test('a cell that is a problem is never reported as a version', () => {
  const repo = getRepo('VastPayPwaV2')!;
  const at = new Date(0);
  for (const problem of ['not migrated', 'n/a', '?']) {
    const [r] = statusJson([repo], [row({ staging: problem, production: problem })], at).repos;
    assert.deepEqual(r.staging, { tag: null, problem });
    assert.deepEqual(r.production, { tag: null, problem });
  }
});

test('drift is a count when it is one, and a problem otherwise', () => {
  const repo = getRepo('VastPay-BackEnd')!;
  const at = new Date(0);
  const drift = (text: string) => statusJson([repo], [row({ name: 'VastPay-BackEnd', drift: text })], at).repos[0].drift;
  assert.deepEqual(drift('in sync'), { text: 'in sync', ahead: 0, problem: null });
  assert.deepEqual(drift('develop +3'), { text: 'develop +3', ahead: 3, problem: null });
  for (const p of ['not cloned', 'fetch failed', 'no develop', '?']) {
    assert.deepEqual(drift(p), { text: p, ahead: null, problem: p });
  }
});
