import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  workflowAcceptsVersion,
  runDoctor,
  tally,
  type Check,
  type DoctorDeps,
} from '../src/utils/doctor.js';
import { getRepo, type RepoConfig } from '../src/config/repos.js';
import { ArgoSsoWallError } from '../src/utils/argocd.js';

const NOW = Date.parse('2026-10-01T12:00:00Z');

// The real header of VastPayPwa's build-deploy.yml on 2026-10-01.
const WORKFLOW = `name: VastPayPwa Pipeline

on:
  workflow_dispatch:
    inputs:
      version:
        description: 'Image version to build and deploy'
        required: true
      environment:
        description: 'Target environment'
        type: choice
`;

// --- workflow parsing ---

test('a dispatchable workflow with a version input is accepted', () => {
  assert.equal(workflowAcceptsVersion(WORKFLOW), true);
});

test('a workflow without a version input, or without workflow_dispatch, is not', () => {
  assert.equal(workflowAcceptsVersion(WORKFLOW.replace('      version:', '      image_tag:')), false);
  assert.equal(workflowAcceptsVersion('on:\n  push:\n    branches: [staging]\n'), false);
});

// --- the whole run, against fakes ---

const REPOS = ['VastPayPwa', 'VastMenu-DashBoard'].map((n) => getRepo(n) as RepoConfig);

function deps(over: Partial<DoctorDeps> = {}): DoctorDeps {
  return {
    now: NOW,
    nodeVersion: '22.22.3',
    has: () => true,
    ghAuthenticated: async () => true,
    currentVersion: '2.6.2',
    latestRelease: async () => 'v2.6.2',
    repos: REPOS,
    repoDir: () => '/checkout',
    fetchWorkflow: async () => WORKFLOW,
    stagingTag: async (r) => (r.name === 'VastPayPwa' ? '1.5.7-rc13' : '2.1.40-rc1'),
    productionTag: async (r) => (r.name === 'VastPayPwa' ? '1.5.6' : '2.1.36'),
    argocd: () => ({
      enabled: true,
      hasToken: true,
      session: async () => ({ loggedIn: true, username: 'admin' }),
    }),
    slack: { token: 'xoxb-test', channel: 'C123', authTest: async () => undefined, channelName: async () => '#releases' },
    ...over,
  };
}

const problems = (checks: Check[]): string[] =>
  checks.filter((c) => c.status !== 'ok').map((c) => `${c.status} ${c.label}: ${c.detail}`);

test('everything healthy: no warnings, no failures', async () => {
  const checks = await runDoctor(deps());
  assert.deepEqual(problems(checks), []);
  assert.deepEqual(tally(checks), { fail: 0, warn: 0 });
});

// The 2026-09-24 rename broke every deploy; this is the check that catches it.
test('a missing build-deploy.yml fails that repo', async () => {
  const checks = await runDoctor(
    deps({
      fetchWorkflow: async (r) => {
        if (r.name === 'VastPayPwa') throw new Error('no .github/workflows/build-deploy.yml on staging');
        return WORKFLOW;
      },
    }),
  );
  const p = problems(checks);
  assert.equal(p.length, 1);
  assert.match(p[0], /^fail VastPayPwa: .*build-deploy\.yml/);
});

test('a staging series behind production warns, naming --fix-version', async () => {
  const checks = await runDoctor(deps({ stagingTag: async () => '2.1.12-rc30' , productionTag: async () => '2.1.36' }));
  const p = problems(checks).filter((x) => x.includes('VastMenu-DashBoard'));
  assert.equal(p.length, 1);
  assert.match(p[0], /^warn VastMenu-DashBoard: next 2\.1\.12-rc31 is not above production 2\.1\.36 .*--fix-version/);
});

test('an unparseable staging tag warns, pointing at --target-version', async () => {
  const checks = await runDoctor(deps({ stagingTag: async () => '1.1.3-rc4-health' }));
  assert.ok(problems(checks).some((x) => /^warn VastPayPwa: .*1\.1\.3-rc4-health.*--target-version/.test(x)));
});

// An expired token stops a deploy before the build, so it is a failure; a
// missing one only loses the confirmation, so it is a warning.
test('ArgoCD: expired token fails, no token warns, SSO wall warns', async () => {
  const argo = (session: () => Promise<{ loggedIn: boolean; username?: string }>, hasToken = true) => () => ({
    enabled: true,
    hasToken,
    session,
  });
  const expired = problems(await runDoctor(deps({ argocd: argo(async () => ({ loggedIn: false })) })));
  assert.ok(expired.some((x) => /^fail ArgoCD staging: .*expired/.test(x)), expired.join('\n'));

  const none = problems(await runDoctor(deps({ argocd: argo(async () => ({ loggedIn: true }), false) })));
  assert.ok(none.some((x) => /^warn ArgoCD staging: .*no token/.test(x)), none.join('\n'));

  const wall = problems(
    await runDoctor(
      deps({
        argocd: argo(async () => {
          throw new ArgoSsoWallError('behind a browser sign-in');
        }),
      }),
    ),
  );
  assert.ok(wall.some((x) => /^warn ArgoCD staging: .*sign-in page.*DevOps/.test(x)), wall.join('\n'));
  assert.ok(!wall.some((x) => /cookie/i.test(x)), 'there is no cookie to suggest any more');
});

test('gh not authenticated: one failure, and no API checks that would all fail the same way', async () => {
  let fetched = 0;
  const checks = await runDoctor(
    deps({
      ghAuthenticated: async () => false,
      fetchWorkflow: async () => {
        fetched++;
        return WORKFLOW;
      },
    }),
  );
  assert.equal(fetched, 0);
  assert.ok(problems(checks).some((x) => /^fail gh: .*gh auth login/.test(x)));
});

test('an older CLI warns with the upgrade command', async () => {
  const p = problems(await runDoctor(deps({ latestRelease: async () => 'v2.7.0' })));
  assert.ok(p.some((x) => /^warn vast-cli: 2\.6\.2 → 2\.7\.0 .*vast upgrade/.test(x)), p.join('\n'));
});

test('a repo not cloned here warns, the rest still run', async () => {
  const p = problems(await runDoctor(deps({ repoDir: (r) => (r.name === 'VastPayPwa' ? null : '/checkout') })));
  assert.ok(p.some((x) => /^warn Checkouts: .*VastPayPwa/.test(x)), p.join('\n'));
});

test('Slack: not set up warns, a rejected token fails', async () => {
  const notSetUp = problems(
    await runDoctor(deps({ slack: { token: null, channel: null, authTest: async () => undefined, channelName: async () => null } })),
  );
  assert.ok(notSetUp.some((x) => /^warn Slack: .*vast slack setup/.test(x)));
  const rejected = problems(
    await runDoctor(
      deps({
        slack: {
          token: 'xoxb-dead',
          channel: 'C1',
          authTest: async () => {
            throw new Error('invalid_auth');
          },
          channelName: async () => null,
        },
      }),
    ),
  );
  assert.ok(rejected.some((x) => /^fail Slack: .*invalid_auth/.test(x)));
});

test('a check that throws is reported, never crashes the run', async () => {
  const checks = await runDoctor(
    deps({
      latestRelease: async () => {
        throw new Error('boom');
      },
    }),
  );
  assert.ok(checks.length > 0);
});
