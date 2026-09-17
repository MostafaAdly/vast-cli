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
import { ArgoUnauthorizedError, rolloutDone, type ArgoApp, type RolloutResult } from '../src/utils/argocd.js';
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

/** What the app is running before the deploy: an older tag, so nothing is already live. */
const STALE: ArgoApp = {
  syncStatus: 'Synced',
  healthStatus: 'Healthy',
  images: ['registry/vastpay-pwa:1.5.6-rc9'],
  revision: 'old000',
};

interface Calls {
  dispatched: string[];
  rollouts: string[];
  /** The done-predicate each rollout wait was given, so a test can exercise it. */
  isDone: Array<((app: ArgoApp) => boolean) | undefined>;
  /** `<app>@<rollouts so far>` — proves the refresh landed before the wait. */
  refreshed: string[];
}

function deps(over: Partial<DeployDeps> = {}): { deps: DeployDeps; calls: Calls } {
  const calls: Calls = { dispatched: [], rollouts: [], isDone: [], refreshed: [] };
  const base: DeployDeps = {
    runWorkflow: async (params) => {
      calls.dispatched.push(`${params.repository}@${params.version}->${params.branch}`);
      return { success: true, runId: 77, message: 'ok' };
    },
    getRunStatus: async () => ({ status: 'completed', conclusion: 'success' }),
    failedStepName: async () => null,
    waitForRollout: async (_label, app, tag, _deps, _timing, isDone): Promise<RolloutResult> => {
      calls.rollouts.push(`${app}:${tag}`);
      calls.isDone.push(isDone);
      return { ok: true, elapsedMs: 42000, app: HEALTHY };
    },
    getApplication: async () => STALE,
    refreshApplication: async (_host, _token, app) => {
      calls.refreshed.push(`${app}@${calls.rollouts.length}`);
    },
    readArgocdToken: () => 'a-token',
    argocdHost: () => 'https://argocd-stg.example.com',
    argocdAppUrl: (_env, app) => `https://argocd-stg.example.com/applications/${app}`,
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

// Not being logged in to ArgoCD must not stop a deploy: the build and the tag
// commit are perfectly valid without it. All that is lost is the confirmation,
// and the summary says so out loud rather than claiming the tag is live.
test('without an ArgoCD token the deploy runs and is reported as unconfirmed', async () => {
  const { slot, lines } = recordingSlot();
  const reads: string[] = [];
  const d = deps({
    readArgocdToken: () => null,
    getApplication: async (_host, _token, app) => {
      reads.push(app);
      return STALE;
    },
  });
  const outcome = await deployOne(REPO, 'staging', '1.5.7-rc1', false, slot, undefined, d.deps);
  assert.equal(outcome.status, 'released');
  assert.deepEqual(d.calls.dispatched, ['VastPayPwa@1.5.7-rc1->staging'], 'the build must still run');
  assert.deepEqual(reads, [], 'there is no token to read the application with');
  assert.deepEqual(d.calls.rollouts, [], 'there is no token to wait on ArgoCD with');
  assert.match(outcome.detail, /rollout not confirmed/);
  assert.match(outcome.detail, /no ArgoCD token/);
  assert.match(outcome.detail, /vast argocd login/);
  assert.ok(!/live on/.test(outcome.detail), 'nothing may claim the tag is live');
  assert.match(lines[lines.length - 1], /run 77 {2}succeeded/);
  assert.match(lines[lines.length - 1], /tag committed — rollout not confirmed \(no ArgoCD token\)/);
});

// The token path is the whole point of the wait, so it must not be weakened by
// the unconfirmed path existing next to it.
test('with an ArgoCD token the ArgoCD wait still runs', async () => {
  const { slot } = recordingSlot();
  const reads: string[] = [];
  const d = deps({
    getApplication: async (_host, _token, app) => {
      reads.push(app);
      return STALE;
    },
  });
  const outcome = await deployOne(REPO, 'staging', '1.5.7-rc1', false, slot, undefined, d.deps);
  assert.equal(outcome.status, 'released');
  assert.deepEqual(reads, ['vastpay-pwa'], 'the pre-dispatch snapshot still happens');
  assert.deepEqual(d.calls.rollouts, ['vastpay-pwa:1.5.7-rc1']);
  assert.match(outcome.detail, /live on vastpay-pwa/);
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

// False green: `rolloutDone` is a snapshot, so re-deploying a version the app is
// already running satisfied the waiter on its first read and reported "released"
// without any rollout at all. The docs tell people to retry a failed tag commit
// with the same version, so this was the common case, not a corner one.
test('a version that is already live waits for a new sync instead of reporting success', async () => {
  const { slot, lines } = recordingSlot();
  const liveNow: ArgoApp = {
    syncStatus: 'Synced',
    healthStatus: 'Healthy',
    images: ['registry/vastpay-pwa:1.5.7-rc1'],
    revision: 'rev-before',
  };
  const d = deps({ getApplication: async () => liveNow });
  const outcome = await deployOne(REPO, 'staging', '1.5.7-rc1', false, slot, undefined, d.deps);

  assert.equal(outcome.status, 'released');
  const isDone = d.calls.isDone[0];
  assert.ok(isDone, 'the waiter must be told what done means when the tag is already live');
  assert.equal(isDone(liveNow), false, 'the unchanged snapshot must not satisfy the wait');
  assert.equal(
    isDone({ ...liveNow, revision: 'rev-after' }),
    true,
    'a new revision, Synced and Healthy on the tag, is the rollout',
  );
  assert.equal(
    lines[1],
    '  VastPayPwa  argocd vastpay-pwa  1.5.7-rc1 already live — waiting for a new sync  0s',
  );
});

test('a version that is not live yet waits on the ordinary definition of done', async () => {
  const { slot, lines } = recordingSlot();
  const d = deps();
  await deployOne(REPO, 'staging', '1.5.7-rc1', false, slot, undefined, d.deps);
  const isDone = d.calls.isDone[0];
  if (isDone) {
    assert.equal(isDone(HEALTHY), true, 'the default predicate is plain rolloutDone');
    assert.equal(isDone(STALE), false);
  }
  assert.ok(
    !lines.some((l) => /already live/.test(l)),
    'nothing was live, so nothing may claim it was',
  );
});

// Reading the app before dispatching is also the cheapest possible token check:
// an expired token found here costs nothing, found after the build it has
// already pushed an image and committed a tag nobody is watching.
test('an expired ArgoCD token found before dispatch fails without building', async () => {
  const { slot } = recordingSlot();
  const d = deps({
    getApplication: async () => {
      throw new ArgoUnauthorizedError('argocd rejected the token: token expired');
    },
  });
  const outcome = await deployOne(REPO, 'staging', '1.5.7-rc1', false, slot, undefined, d.deps);
  assert.equal(outcome.status, 'failed');
  assert.match(outcome.detail, /argocd unauthorized/);
  assert.match(outcome.detail, /vast argocd login/);
  assert.deepEqual(d.calls.dispatched, [], 'nothing may be built against a dead token');
  assert.deepEqual(d.calls.rollouts, []);
});

// Any other read failure is only a missing snapshot. Refusing to deploy because
// ArgoCD blipped would be worse than losing the already-live check.
test('an ordinary pre-read failure does not block the deploy', async () => {
  const { slot } = recordingSlot();
  const d = deps({
    getApplication: async () => {
      throw new Error('ECONNRESET');
    },
  });
  const outcome = await deployOne(REPO, 'staging', '1.5.7-rc1', false, slot, undefined, d.deps);
  assert.equal(outcome.status, 'released');
  assert.deepEqual(d.calls.dispatched, ['VastPayPwa@1.5.7-rc1->staging']);
});

// `runWorkflow` returns success with no runId when it dispatched fine but could
// not find the run in time. Reporting "could not identify the dispatched run"
// hid the fact that a build IS running and will commit a tag.
test('a dispatched run that cannot be identified says the build is running anyway', async () => {
  const { slot } = recordingSlot();
  const d = deps({ runWorkflow: async () => ({ success: true, message: 'dispatched' }) });
  const outcome = await deployOne(REPO, 'staging', '1.5.7-rc1', false, slot, undefined, d.deps);
  assert.equal(outcome.status, 'failed');
  assert.match(outcome.detail, /dispatched, but its run could not be identified/);
  assert.match(outcome.detail, /https:\/\/github\.com\/Vast-menu\/VastPayPwa\/actions/);
  assert.match(outcome.detail, /vast deploy VastPayPwa --target-version 1\.5\.7-rc1/);
  assert.match(outcome.detail, /only if nothing is running/);
  assert.deepEqual(d.calls.rollouts, []);
});

// The ArgoCD link is built once, from config, so the board line and the summary
// can never point at two different servers.
test('the released detail and the board line share one ArgoCD app URL', async () => {
  const { slot, lines } = recordingSlot();
  const d = deps({
    argocdAppUrl: (_env, app) => `https://argocd.test/applications/${app}`,
  });
  const outcome = await deployOne(REPO, 'staging', '1.5.7-rc1', false, slot, undefined, d.deps);
  assert.match(outcome.detail, /https:\/\/argocd\.test\/applications\/vastpay-pwa/);
  assert.match(lines[lines.length - 1], /https:\/\/argocd\.test\/applications\/vastpay-pwa/);
});

// ArgoCD polls git every ~3 minutes. Asking it to refresh right after the build
// commits the tag turns that poll into seconds, so the wait measures the rollout
// and not ArgoCD's timer.
test('after a green run the app is refreshed once, before the rollout wait', async () => {
  const { slot } = recordingSlot();
  const { deps: d, calls } = deps();
  const outcome = await deployOne(REPO, 'staging', '1.5.7-rc1', false, slot, undefined, d);
  assert.equal(outcome.status, 'released');
  assert.deepEqual(calls.refreshed, ['vastpay-pwa@0']);
  assert.deepEqual(calls.rollouts, ['vastpay-pwa:1.5.7-rc1']);
});

test('a failed refresh does not fail the deploy — the wait still runs', async () => {
  const { slot } = recordingSlot();
  const { deps: d, calls } = deps({
    refreshApplication: async () => {
      throw new Error('argocd: 503');
    },
  });
  const outcome = await deployOne(REPO, 'staging', '1.5.7-rc1', false, slot, undefined, d);
  assert.equal(outcome.status, 'released');
  assert.deepEqual(calls.rollouts, ['vastpay-pwa:1.5.7-rc1']);
});

test('without a token there is nothing to refresh with', async () => {
  const { slot } = recordingSlot();
  const { deps: d, calls } = deps({ readArgocdToken: () => null });
  await deployOne(REPO, 'staging', '1.5.7-rc1', false, slot, undefined, d);
  assert.deepEqual(calls.refreshed, []);
});
