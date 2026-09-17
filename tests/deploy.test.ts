import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deployOne,
  deployTargets,
  notClonedOutcome,
  validateDeployOptions,
  versionFor,
  type DeployDeps,
  type DeploySlot,
  type Sweep,
} from '../src/commands/deploy.js';
import { getRepo } from '../src/config/repos.js';
import type { ArgoApp, RolloutResult } from '../src/utils/argocd.js';
import type { StatusBoard } from '../src/utils/status-board.js';

/** The sweep flags, so a test only has to name the one it cares about. */
function sweep(over: Partial<Sweep> = {}): Sweep {
  return { all: false, frontend: false, backend: false, ...over };
}

const targetNames = (names: string[], s: Sweep): string[] =>
  deployTargets(names, s).repos.map((r) => r.name);

// Regression: `vast deploy --all` must never include an unreleasable repo.
// It previously iterated the raw REPOS list, so an unreleasable repo
// (Terraform, vastpay-payment-odoo, Vast-Finance) that simply was not cloned
// yet produced a 'failed' outcome and took process.exit(1) down with it.
test('--all targets only releasable repos', () => {
  const names = targetNames([], sweep({ all: true }));
  assert.ok(!names.includes('Terraform'), 'Terraform is not releasable and must not be a target');
  assert.ok(
    !names.includes('vastpay-payment-odoo'),
    'vastpay-payment-odoo is not releasable and must not be a target',
  );
  assert.ok(!names.includes('Vast-Finance'), 'Vast-Finance is not releasable and must not be a target');
  assert.ok(names.includes('VastPayPwa'), 'a releasable repo must still be a target');
});

// deploy's sweeps are release's sweeps. Two commands that disagree on what
// `--frontend` means would be worse than no sweep at all.
test('--frontend and --backend are the release trains, and --all is both', () => {
  const front = targetNames([], sweep({ frontend: true }));
  const back = targetNames([], sweep({ backend: true }));
  assert.deepEqual(back, ['VastPay-BackEnd', 'VastMenu-BackEnd']);
  assert.deepEqual(targetNames([], sweep({ all: true })), [...front, ...back]);
  assert.ok(
    !front.includes('vast-menu-payments'),
    'vast-menu-payments is in no train on purpose — deploy it by name',
  );
});

test('a named repo is targeted regardless of releasability', () => {
  // Explicit targeting is unfiltered — only a sweep is scoped to the trains,
  // since a direct `vast deploy Terraform` should still surface "no deploy
  // workflow exists" rather than "unknown repository".
  assert.deepEqual(targetNames(['Terraform'], sweep()), ['Terraform']);
});

test('an unknown repo name targets nothing and is reported', () => {
  const { repos, unknown } = deployTargets(['NotARepo'], sweep());
  assert.deepEqual(repos, []);
  assert.deepEqual(unknown, ['NotARepo']);
});

test('the same repo named twice, in any casing, is one target', () => {
  assert.deepEqual(targetNames(['VastPayPwa', 'vastpaypwa'], sweep()), ['VastPayPwa']);
});

// Option validation runs before anything is dispatched: a bad combination must
// refuse the whole command, never deploy the first repo and then complain.
test('a sweep flag together with names is refused', () => {
  assert.match(
    validateDeployOptions(['VastPayPwa'], { ...sweep({ frontend: true }) }) ?? '',
    /--frontend/,
  );
});

test('--target-version and --dir are per-repo, so a sweep refuses them', () => {
  assert.match(
    validateDeployOptions([], { ...sweep({ all: true }), targetVersion: '1.2.3' }) ?? '',
    /--target-version/,
  );
  assert.match(validateDeployOptions([], { ...sweep({ all: true }), dir: '/tmp/x' }) ?? '', /--dir/);
  assert.equal(validateDeployOptions(['VastPayPwa'], { ...sweep(), targetVersion: '1.2.3' }), null);
});

test('production ships what baked in staging, with the candidate suffix dropped', () => {
  assert.equal(versionFor('production', '2.1.0-rc45'), '2.1.0');
  assert.equal(versionFor('staging', '2.1.0-rc45'), '2.1.0-rc46');
});

// Filtering a sweep to the trains fixed the instance, not the class: a repo
// that IS releasable but simply is not on this machine still failed the sweep
// and took exit 1 with it. A frontend teammate has no backend checkouts, and
// that is the normal state on a portable CLI.
test('an uncloned repo is skipped during a sweep, not failed', () => {
  assert.equal(notClonedOutcome('VastPay-BackEnd', true).status, 'skipped');
});

test('an uncloned repo the user named explicitly is a failure', () => {
  assert.equal(notClonedOutcome('VastPay-BackEnd', false).status, 'failed');
});

test('either way the outcome says the repo is not cloned', () => {
  for (const all of [true, false]) {
    const outcome = notClonedOutcome('VastPay-BackEnd', all);
    assert.equal(outcome.repo, 'VastPay-BackEnd');
    assert.match(outcome.detail, /not cloned/);
    assert.match(outcome.detail, /vast clone/);
  }
});

// ---------------------------------------------------------------------------
// deployOne. Every dep is injected: no gh, no network, and nothing production.
// ---------------------------------------------------------------------------

const REPO = getRepo('VastPayPwa')!;

/** The board line each row was last given, so a test can read what was reported. */
function recordingSlot(): { slot: DeploySlot; lines: string[]; rows: number[] } {
  const lines: string[] = [];
  const rows: number[] = [];
  const board: StatusBoard = {
    update: (row, text) => {
      rows.push(row);
      lines.push(text);
    },
  };
  return { slot: { board, row: 3, labelWidth: 10 }, lines, rows };
}

const HEALTHY: ArgoApp = {
  syncStatus: 'Synced',
  healthStatus: 'Healthy',
  images: ['registry/vastpay-pwa:1.5.7-rc1'],
  revision: 'abc123',
};

interface Calls {
  dispatched: string[];
  rollouts: string[];
}

function deps(over: Partial<DeployDeps> = {}): { deps: DeployDeps; calls: Calls } {
  const calls: Calls = { dispatched: [], rollouts: [] };
  const base: DeployDeps = {
    runWorkflow: async (params) => {
      calls.dispatched.push(`${params.repository}@${params.version}->${params.branch}`);
      return { success: true, runId: 77, message: 'ok' };
    },
    getRunStatus: async () => ({ status: 'completed', conclusion: 'success' }),
    failedStepName: async () => null,
    waitForRollout: async (_label, app, tag): Promise<RolloutResult> => {
      calls.rollouts.push(`${app}:${tag}`);
      return { ok: true, elapsedMs: 42000, app: HEALTHY };
    },
    getApplication: async () => HEALTHY,
    readArgocdToken: () => 'a-token',
    argocdHost: () => 'https://argocd-stg.example.com',
    ...over,
  };
  return { deps: base, calls };
}

test('a dry run reports the version and dispatches nothing', async () => {
  const { slot, lines } = recordingSlot();
  const d = deps();
  const outcome = await deployOne(REPO, 'staging', '1.5.7-rc1', true, slot, undefined, d.deps);
  assert.equal(outcome.status, 'skipped');
  assert.equal(outcome.detail, 'dry run');
  assert.deepEqual(d.calls.dispatched, [], 'a dry run must dispatch nothing');
  assert.match(lines.join('\n'), /1\.5\.7-rc1/, 'the derived version is what a dry run is for');
});

// The whole point of the ArgoCD wait is that a deploy is confirmed. Dispatching
// without a token would push an image and commit a tag while reporting a
// failure, leaving nobody able to say whether the cluster took it.
test('a missing ArgoCD token refuses before anything is dispatched', async () => {
  const { slot } = recordingSlot();
  const d = deps({ readArgocdToken: () => null });
  const outcome = await deployOne(REPO, 'staging', '1.5.7-rc1', false, slot, undefined, d.deps);
  assert.equal(outcome.status, 'failed');
  assert.match(outcome.detail, /no ArgoCD token for staging/);
  assert.match(outcome.detail, /vast argocd login/);
  assert.deepEqual(d.calls.dispatched, [], 'nothing may be dispatched without a way to confirm it');
  assert.deepEqual(d.calls.rollouts, []);
});

test('a repo with no workflow for the env is skipped, not failed', async () => {
  const { slot } = recordingSlot();
  const d = deps();
  const outcome = await deployOne(getRepo('Terraform')!, 'staging', '1.0.0', false, slot, undefined, d.deps);
  assert.equal(outcome.status, 'skipped');
  assert.match(outcome.detail, /no deploy workflow/);
  assert.deepEqual(d.calls.dispatched, []);
});

test('a successful run and rollout is released, with the ArgoCD app URL', async () => {
  const { slot, lines, rows } = recordingSlot();
  const d = deps();
  const outcome = await deployOne(REPO, 'staging', '1.5.7-rc1', false, slot, undefined, d.deps);
  assert.equal(outcome.status, 'released');
  assert.deepEqual(d.calls.dispatched, ['VastPayPwa@1.5.7-rc1->staging']);
  // The app name is the Vast-deployments folder, not the repo name.
  assert.deepEqual(d.calls.rollouts, ['vastpay-pwa:1.5.7-rc1']);
  assert.match(outcome.detail, /1\.5\.7-rc1 live on vastpay-pwa/);
  assert.match(outcome.detail, /https:\/\/argocd-stg\.example\.com\/applications\/vastpay-pwa/);
  assert.match(lines[lines.length - 1], /argocd vastpay-pwa {2}Synced\/Healthy/);
  assert.ok(
    rows.every((r) => r === 3),
    'every line must land on this repo’s own row, or the board loses the cursor',
  );
});

// A run that dies in the tag-commit step has usually already built and pushed
// the image, so the retry is cheap — and saying so saves a pointless rebuild.
test('a run that fails while committing the tag says the image may already be built', async () => {
  const { slot } = recordingSlot();
  const d = deps({
    getRunStatus: async () => ({ status: 'completed', conclusion: 'failure' }),
    failedStepName: async () => 'Run vast-menu/update-helm-tag@v1',
  });
  const outcome = await deployOne(REPO, 'staging', '1.5.7-rc1', false, slot, undefined, d.deps);
  assert.equal(outcome.status, 'failed');
  assert.match(outcome.detail, /failed committing the tag/);
  assert.match(outcome.detail, /image may already be built/);
  assert.match(outcome.detail, /actions\/runs\/77/);
  assert.deepEqual(d.calls.rollouts, [], 'a failed build is never waited on');
});

test('a run that fails anywhere else just reports the run URL', async () => {
  const { slot } = recordingSlot();
  const d = deps({
    getRunStatus: async () => ({ status: 'completed', conclusion: 'failure' }),
    failedStepName: async () => 'Build image',
  });
  const outcome = await deployOne(REPO, 'staging', '1.5.7-rc1', false, slot, undefined, d.deps);
  assert.equal(outcome.status, 'failed');
  assert.match(outcome.detail, /run 77 failed/);
  assert.ok(!/committing the tag/.test(outcome.detail));
});

// The build going green is not the release. Reporting "released" on a rollout
// that never happened is the exact failure this whole change exists to end.
test('a rollout that times out fails, and never claims the tag is live', async () => {
  const { slot, lines } = recordingSlot();
  const d = deps({
    waitForRollout: async () => ({ ok: false, elapsedMs: 600000, reason: 'timed out after 10m00s' }),
  });
  const outcome = await deployOne(REPO, 'staging', '1.5.7-rc1', false, slot, undefined, d.deps);
  assert.equal(outcome.status, 'failed');
  assert.match(outcome.detail, /timed out after 10m00s/);
  assert.ok(!/live on/.test(outcome.detail));
  assert.match(lines[lines.length - 1], /argocd vastpay-pwa/);
});

test('an unauthorized rollout points at `vast argocd login` rather than retrying forever', async () => {
  const { slot } = recordingSlot();
  const d = deps({
    waitForRollout: async () => ({
      ok: false,
      elapsedMs: 1000,
      reason: 'argocd unauthorized — run `vast argocd login`',
    }),
  });
  const outcome = await deployOne(REPO, 'staging', '1.5.7-rc1', false, slot, undefined, d.deps);
  assert.equal(outcome.status, 'failed');
  assert.match(outcome.detail, /vast argocd login/);
});

test('a dispatch that cannot be identified fails without waiting on a run', async () => {
  const { slot } = recordingSlot();
  const d = deps({ runWorkflow: async () => ({ success: false, error: 'gh exploded', message: '' }) });
  const outcome = await deployOne(REPO, 'staging', '1.5.7-rc1', false, slot, undefined, d.deps);
  assert.equal(outcome.status, 'failed');
  assert.equal(outcome.detail, 'gh exploded');
  assert.deepEqual(d.calls.rollouts, []);
});
