import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEPLOYMENTS_REPO, deployedTag } from '../src/utils/deployments.js';
import type { FetchFile } from '../src/utils/deployments.js';
import type { RepoConfig } from '../src/config/repos.js';

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
  workflow: { staging: 'build-deploy.yml', production: 'build-deploy.yml' },
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

test('DEPLOYMENTS_REPO is the deployments repo name', () => {
  assert.equal(DEPLOYMENTS_REPO, 'Vast-deployments');
});

// --- production: Vast-deployments only ---
//
// Every releasable repo has had a production file in Vast-deployments since
// 2026-09-23, and the pipelines commit to them. The app repo's own Helm values
// stopped moving then, so nothing falls back to them any more.

const PROD_PATH = 'deployments/helm/production/vastpay-dashboard/prod.yaml';

const prodRepo = (): RepoConfig => repo({ deployments: { staging: 'deployments/helm/staging/vastpay-dasaboard/stage.yaml', production: PROD_PATH } });

const PROD_YAML = `deployment:
  containers:
    - image:
        tag: "2.2.1"
`;

test("production's tag is read from its own Vast-deployments file", async () => {
  const asked: string[] = [];
  const fetchFile: FetchFile = async (path) => {
    asked.push(path);
    return PROD_YAML;
  };
  assert.equal(await deployedTag(prodRepo(), 'production', fetchFile), '2.2.1');
  assert.deepEqual(asked, [PROD_PATH]);
});

test('a missing production file is an error, never a guess from elsewhere', async () => {
  const fetchFile: FetchFile = async (path) => {
    throw new Error(`no ${path} in ${DEPLOYMENTS_REPO}`);
  };
  await assert.rejects(() => deployedTag(prodRepo(), 'production', fetchFile), new RegExp(`no ${PROD_PATH} in ${DEPLOYMENTS_REPO}`));
});

test('a production file with no tag line is an error', async () => {
  const fetchFile: FetchFile = async () => 'deployment:\n  replicas: 1\n';
  await assert.rejects(() => deployedTag(prodRepo(), 'production', fetchFile), /No `tag:` found/);
});
