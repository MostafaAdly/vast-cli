import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEPLOYMENTS_REPO,
  deployedTag,
  deploymentsFileUrl,
} from '../src/utils/deployments.js';
import type { FetchFile } from '../src/utils/deployments.js';
import type { RepoConfig } from '../src/config/repos.js';
import { ORG } from '../src/utils/remote.js';

const STAGE_YAML = `deployment:
  replicas: 1
  containers:
    - name: vastpay-dasaboard
      image:
        repository: vastregistry.azurecr.io/vastpay-dasaboard
        tag: "2.1.3-rc20"
        pullPolicy: Always
`;

/** A repo whose staging file exists and whose production file does not. */
const repo = (overrides: Partial<RepoConfig> = {}): RepoConfig => ({
  name: 'VastPay-DashBoard',
  workflow: { staging: 'build-deploy', production: 'build-deploy' },
  deployments: {
    staging: 'deployments/helm/staging/vastpay-dasaboard/stage.yaml',
    production: null,
  },
  promoteFrom: { staging: 'develop', production: 'staging' },
  teams: ['frontend'],
  releaseTeam: 'frontend',
  ...overrides,
});

test('deployedTag returns the first tag from a stage.yaml', async () => {
  const seen: string[] = [];
  const fetchFile: FetchFile = async (path) => {
    seen.push(path);
    return STAGE_YAML;
  };
  assert.equal(await deployedTag(repo(), 'staging', fetchFile), '2.1.3-rc20');
  assert.deepEqual(seen, ['deployments/helm/staging/vastpay-dasaboard/stage.yaml']);
});

test('deployedTag throws with the repo name when the env file is null', async () => {
  const fetchFile: FetchFile = async () => {
    throw new Error('should not be called');
  };
  await assert.rejects(() => deployedTag(repo(), 'production', fetchFile), {
    message: 'VastPay-DashBoard has no production deployments file',
  });
});

test('deployedTag propagates the fetcher rejection message', async () => {
  const path = 'deployments/helm/staging/vastpay-dasaboard/stage.yaml';
  const fetchFile: FetchFile = async () => {
    throw new Error(`no ${path} in Vast-deployments`);
  };
  await assert.rejects(() => deployedTag(repo(), 'staging', fetchFile), {
    message: `no ${path} in Vast-deployments`,
  });
});

test('deploymentsFileUrl points at the file on main', () => {
  assert.equal(
    deploymentsFileUrl('deployments/helm/staging/pwa/stage.yaml'),
    `https://github.com/${ORG}/${DEPLOYMENTS_REPO}/blob/main/deployments/helm/staging/pwa/stage.yaml`,
  );
});

test('DEPLOYMENTS_REPO is the deployments repo name', () => {
  assert.equal(DEPLOYMENTS_REPO, 'Vast-deployments');
});
