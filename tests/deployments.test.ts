import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEPLOYMENTS_REPO, deployedTag, productionTag } from '../src/utils/deployments.js';
import type { FetchFile } from '../src/utils/deployments.js';
import type { RepoConfig } from '../src/config/repos.js';
import { PRE_MIGRATION_PRODUCTION_HELM } from '../src/utils/helm.js';

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

test('DEPLOYMENTS_REPO is the deployments repo name', () => {
  assert.equal(DEPLOYMENTS_REPO, 'Vast-deployments');
});

// --- productionTag: Vast-deployments first, the app repo's Helm as fallback ---
//
// Production is not migrated: seven of nine repos have no file in
// Vast-deployments at all, and the two seeds may carry no `tag:` line yet.

const PROD_PATH = 'deployments/helm/production/VastPay-DashBoard/prod.yaml';

const prodRepo = (): RepoConfig => repo({ deployments: { staging: 'deployments/helm/staging/vastpay-dasaboard/stage.yaml', production: PROD_PATH } });

const PROD_YAML = `deployment:
  containers:
    - image:
        tag: "2.2.1"
`;

test('productionTag prefers Vast-deployments when the file is there', async () => {
  const fetchFile: FetchFile = async () => PROD_YAML;
  const readAtRef = (): string => {
    throw new Error('should not be called');
  };
  assert.deepEqual(await productionTag(prodRepo(), '/repo', fetchFile, readAtRef), {
    tag: '2.2.1',
    source: 'vast-deployments',
  });
});

test('productionTag falls back to the app repo Helm when the file is missing', async () => {
  const fetchFile: FetchFile = async () => {
    throw new Error(`no ${PROD_PATH} in Vast-deployments`);
  };
  const seen: string[][] = [];
  const readAtRef = (dir: string, ref: string, helmPath: string): string => {
    seen.push([dir, ref, helmPath]);
    return '2.2.1';
  };
  assert.deepEqual(await productionTag(prodRepo(), '/repo', fetchFile, readAtRef), {
    tag: '2.2.1',
    source: 'app-repo',
  });
  assert.deepEqual(seen, [['/repo', 'origin/production', PRE_MIGRATION_PRODUCTION_HELM]]);
});

test('productionTag falls back when the seeded file has no tag line', async () => {
  const fetchFile: FetchFile = async () => 'deployment:\n  replicas: 1\n';
  const readAtRef = (): string => '2.2.1';
  assert.deepEqual(await productionTag(prodRepo(), '/repo', fetchFile, readAtRef), {
    tag: '2.2.1',
    source: 'app-repo',
  });
});

test('productionTag names both places when neither has the tag', async () => {
  const fetchFile: FetchFile = async () => {
    throw new Error(`no ${PROD_PATH} in Vast-deployments`);
  };
  const readAtRef = (): string => {
    throw new Error('Could not read Helm/values-prod.yaml at origin/production. Is the ref fetched?');
  };
  await assert.rejects(() => productionTag(prodRepo(), '/repo', fetchFile, readAtRef), (error: Error) => {
    assert.match(error.message, /^no .* in Vast-deployments/);
    assert.match(error.message, new RegExp(PRE_MIGRATION_PRODUCTION_HELM.replace('/', '\\/')));
    return true;
  });
});

test('productionTag names both places when the repo is not cloned', async () => {
  const fetchFile: FetchFile = async () => {
    throw new Error(`no ${PROD_PATH} in Vast-deployments`);
  };
  const readAtRef = (): string => {
    throw new Error('should not be called');
  };
  await assert.rejects(() => productionTag(prodRepo(), null, fetchFile, readAtRef), (error: Error) => {
    assert.match(error.message, /^no .* in Vast-deployments/);
    assert.match(error.message, /Helm\/values-prod\.yaml/);
    return true;
  });
});

test('productionTag does not fall back on a network or auth failure', async () => {
  const fetchFile: FetchFile = async () => {
    throw new Error(`Could not read ${PROD_PATH} from Vast-deployments: gh: connection reset`);
  };
  const readAtRef = (): string => {
    throw new Error('should not be called');
  };
  await assert.rejects(() => productionTag(prodRepo(), '/repo', fetchFile, readAtRef), {
    message: `Could not read ${PROD_PATH} from Vast-deployments: gh: connection reset`,
  });
});
