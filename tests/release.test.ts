import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A releaseMany test that forgets a fake falls through to the real check and
// promote. With HOME and VAST_CLI_HOME empty, no repo resolves to a checkout,
// so that can never fetch, merge or push in a developer's real clone.
const SANDBOX = mkdtempSync(join(tmpdir(), 'vast-release-test-'));
process.env.HOME = SANDBOX;
process.env.VAST_CLI_HOME = join(SANDBOX, '.vast-cli');
import {
  isSweep,
  planEvent,
  pollIntervalFor,
  prepareOne,
  promoteOne,
  pollTimingFor,
  releaseMany,
  releaseTargets,
  runRelease,
  validateReleaseOptions,
  type ReleaseOptions,
  type Sweep,
} from '../src/commands/release.js';
import { deployMany, notClonedOutcome, type Deployable, type DeployOutcome } from '../src/commands/deploy.js';
import { getRepo, type RepoConfig } from '../src/config/repos.js';
import type { StatusBoard } from '../src/utils/status-board.js';
import { streamToEnd, type VastEvent } from '../src/utils/events.js';

/** The sweep flags, so a test only has to name the one it cares about. */
function sweep(over: Partial<Sweep> = {}): Sweep {
  return { all: false, frontend: false, backend: false, ...over };
}

/** Validation options, likewise: the booleans always exist, defaulted to off. */
function opts(
  over: Partial<{
    all: boolean;
    frontend: boolean;
    backend: boolean;
    targetVersion: string;
    dir: string;
    bump: string;
  }> = {},
): { all: boolean; frontend: boolean; backend: boolean; targetVersion?: string; dir?: string; bump?: string } {
  return { all: false, frontend: false, backend: false, ...over };
}

const FRONTEND_TRAIN = [
  'VastMenu-DashBoard',
  'VastMenuPwa',
  'VastMenuPwaV2',
  'VastPay-DashBoard',
  'VastPayPwa',
  'VastPayPwaV2',
];
const BACKEND_TRAIN = ['VastMenu-BackEnd', 'VastPay-BackEnd'];

const targetNames = (names: string[], s: Sweep): string[] =>
  releaseTargets(names, s).repos.map((r) => r.name);

// Regression: `vast release --all` must never include an unreleasable repo.
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

// The trains are the whole point of a sweep: --all is the frontend train
// followed by the backend train, nothing else, in that order.
test('--all is the six frontend repos then the two backend repos', () => {
  const names = targetNames([], sweep({ all: true }));
  assert.equal(names.length, FRONTEND_TRAIN.length + BACKEND_TRAIN.length);
  const front = names.slice(0, FRONTEND_TRAIN.length);
  const back = names.slice(FRONTEND_TRAIN.length);
  assert.deepEqual([...front].sort(), FRONTEND_TRAIN);
  assert.deepEqual([...back].sort(), BACKEND_TRAIN);
  // The block order is the trains', not the config's: frontend, then backend.
  assert.deepEqual(names, [
    ...targetNames([], sweep({ frontend: true })),
    ...targetNames([], sweep({ backend: true })),
  ]);
});

// vast-menu-payments is deliberately in no train — it is releasable by name
// only. The infra and finance repos are not releasable at all.
test('--all leaves out vast-menu-payments and every unreleasable repo', () => {
  const names = targetNames([], sweep({ all: true }));
  assert.ok(
    !names.includes('vast-menu-payments'),
    'vast-menu-payments is in no train on purpose — release it by name',
  );
  for (const off of ['Terraform', 'Vast-Finance', 'vastpay-payment-odoo']) {
    assert.ok(!names.includes(off), `${off} must never be swept`);
  }
});

test('--frontend is exactly the frontend train', () => {
  assert.deepEqual(targetNames([], sweep({ frontend: true })).sort(), FRONTEND_TRAIN);
});

test('--backend is exactly the backend train', () => {
  assert.deepEqual(targetNames([], sweep({ backend: true })).sort(), BACKEND_TRAIN);
});

test('--frontend --backend together is the same as --all', () => {
  assert.deepEqual(
    targetNames([], sweep({ frontend: true, backend: true })),
    targetNames([], sweep({ all: true })),
  );
});

test('vast-menu-payments is still releasable when it is named', () => {
  assert.deepEqual(targetNames(['vast-menu-payments'], sweep()), ['vast-menu-payments']);
});

test('isSweep is true for any sweep flag and false for none', () => {
  assert.equal(isSweep(sweep()), false);
  assert.equal(isSweep(sweep({ all: true })), true);
  assert.equal(isSweep(sweep({ frontend: true })), true);
  assert.equal(isSweep(sweep({ backend: true })), true);
});

test('a named repo is targeted regardless of releasability', () => {
  const names = targetNames(['Terraform'], sweep());
  assert.deepEqual(names, ['Terraform']);
});

test('an unknown repo name targets nothing and is reported', () => {
  const { repos, unknown } = releaseTargets(['NotARepo'], sweep());
  assert.deepEqual(repos, []);
  assert.deepEqual(unknown, ['NotARepo']);
});

// `vast release A B` releases both. Names resolve to their canonical spelling
// and keep the order they were typed in, so the output reads top to bottom
// the way the user thinks about it.
test('several names resolve to canonical configs in the order given', () => {
  const names = targetNames(['Vastmenu-Dashboard', 'Vastpay-Dashboard'], sweep());
  assert.deepEqual(names, ['VastMenu-DashBoard', 'VastPay-DashBoard']);
});

test('the same repo named twice, in any casing, is one target', () => {
  const names = targetNames(['VastPayPwa', 'vastpaypwa'], sweep());
  assert.deepEqual(names, ['VastPayPwa']);
});

test('every unknown name is reported while the known ones still resolve', () => {
  const { repos, unknown } = releaseTargets(['VastPayPwa', 'Nope', 'Nada'], sweep());
  assert.deepEqual(
    repos.map((r) => r.name),
    ['VastPayPwa'],
  );
  assert.deepEqual(unknown, ['Nope', 'Nada']);
});

// Option validation runs before anything is touched: a bad combination must
// refuse the whole command, never release the first repo and then complain.
test('--all together with names is refused', () => {
  assert.match(validateReleaseOptions(['VastPayPwa'], opts({ all: true })) ?? '', /--all/);
});

// Every sweep flag is exclusive with names, not just --all.
test('--frontend together with a name is refused', () => {
  assert.match(
    validateReleaseOptions(['VastPayPwa'], opts({ frontend: true })) ?? '',
    /--frontend/,
  );
});

test('--target-version is per-repo, so it is refused with more than one repo', () => {
  const err = validateReleaseOptions(['VastPayPwa', 'VastMenuPwa'], opts({ targetVersion: '1.2.3' }));
  assert.match(err ?? '', /--target-version/);
  assert.equal(validateReleaseOptions(['VastPayPwa'], opts({ targetVersion: '1.2.3' })), null);
});

test('--dir names one checkout, so it is refused with more than one repo', () => {
  const err = validateReleaseOptions(['VastPayPwa', 'VastMenuPwa'], opts({ dir: '/tmp/x' }));
  assert.match(err ?? '', /--dir/);
  assert.equal(validateReleaseOptions(['VastPayPwa'], opts({ dir: '/tmp/x' })), null);
});

test('--backend is refused with --dir', () => {
  assert.match(validateReleaseOptions([], opts({ backend: true, dir: '/tmp/x' })) ?? '', /--dir/);
});

test('--frontend is refused with --target-version', () => {
  assert.match(
    validateReleaseOptions([], opts({ frontend: true, targetVersion: '1.2.3' })) ?? '',
    /--target-version/,
  );
});

test('both trains at once with --bump is a valid combination', () => {
  assert.equal(
    validateReleaseOptions([], opts({ frontend: true, backend: true, bump: 'minor' })),
    null,
  );
});

test('--bump and --target-version are mutually exclusive', () => {
  const err = validateReleaseOptions(['VastPayPwa'], opts({ bump: 'minor', targetVersion: '1.2.3' }));
  assert.match(err ?? '', /mutually exclusive/);
});

test('an unknown --bump level is refused', () => {
  assert.match(validateReleaseOptions(['VastPayPwa'], opts({ bump: 'huge' })) ?? '', /--bump/);
});

test('several repos with --bump is a valid combination', () => {
  assert.equal(
    validateReleaseOptions(['VastPayPwa', 'VastMenuPwa'], opts({ bump: 'minor' })),
    null,
  );
});

// `vast release --all` shares deploy's outcome shape, and the same rule: a
// releasable repo you were never meant to have is skipped, not failed, so a
// frontend teammate's sweep does not exit 1 over the backend repos.
test('an uncloned repo is skipped during a sweep, not failed', () => {
  assert.equal(notClonedOutcome('VastMenu-BackEnd', true).status, 'skipped');
});

test('an uncloned repo the user named explicitly is a failure', () => {
  assert.equal(notClonedOutcome('VastMenu-BackEnd', false).status, 'failed');
});

// The backends have no usable develop; failing their release for a promotion
// that cannot exist made `vast release <backend>` unusable and turned every
// `release --all` sweep red on any machine with backend checkouts.
test('release skips promotion for repos with no develop, and only those', async () => {
  const { needsPromotion } = await import('../src/commands/release.js');
  const { getRepo } = await import('../src/config/repos.js');
  assert.equal(needsPromotion(getRepo('VastPay-BackEnd')!), false);
  assert.equal(needsPromotion(getRepo('VastMenu-BackEnd')!), false);
  assert.equal(needsPromotion(getRepo('VastPayPwa')!), true);
  assert.equal(needsPromotion(getRepo('vast-menu-payments')!), true);
});

// --all is the same shape as naming every repo, so the per-repo options must
// be refused there too — the help text and README both say they are. And a
// repo named twice is still one repo, so casing must not turn it into "many".
test('--all is refused with --dir', () => {
  assert.match(validateReleaseOptions([], opts({ all: true, dir: '/tmp/x' })) ?? '', /--dir/);
});

test('--all is refused with --target-version', () => {
  assert.match(
    validateReleaseOptions([], opts({ all: true, targetVersion: '1.2.3' })) ?? '',
    /--target-version/,
  );
});

test('one repo named twice in different casing still accepts --target-version', () => {
  assert.equal(
    validateReleaseOptions(['VastPayPwa', 'vastpaypwa'], opts({ targetVersion: '1.2.3' })),
    null,
  );
});

// The poll interval scales with how many runs are being watched: one second
// per run, never faster than the single-run rate.
test('the poll interval is one second per run, floored at five seconds', () => {
  assert.equal(pollIntervalFor(1), 5000);
  assert.equal(pollIntervalFor(2), 5000);
  assert.equal(pollIntervalFor(5), 5000);
  assert.equal(pollIntervalFor(9), 9000);
});

// On a TTY every line is rewritten in place, so the heartbeat can fire on every
// poll: the elapsed time on each repo's line stays live at no extra cost in
// scrollback. Piped output appends, so it keeps the slow 30s heartbeat.
test('a live board heartbeats on every poll, piped output every 30s', () => {
  assert.deepEqual(pollTimingFor(2, true), {
    pollMs: 5000,
    heartbeatMs: 5000,
    maxConsecutiveErrors: 12,
  });
  assert.deepEqual(pollTimingFor(2, false), {
    pollMs: 5000,
    heartbeatMs: 30000,
    maxConsecutiveErrors: 12,
  });
});

test('the live heartbeat follows the scaled poll interval', () => {
  assert.deepEqual(pollTimingFor(9, true), {
    pollMs: 9000,
    heartbeatMs: 9000,
    maxConsecutiveErrors: 12,
  });
});

const MANY_OPTIONS: ReleaseOptions = {
  to: 'staging',
  dryRun: false,
  skipPromote: false,
  all: false,
  frontend: false,
  backend: false,
};

const FOUR = ['VastPayPwa', 'VastMenuPwa', 'VastPay-DashBoard', 'VastMenu-DashBoard'];

function targetsFor(names: string[]): RepoConfig[] {
  return names.map((n) => getRepo(n)!);
}

/** A and C refuse; B and D come out ready to deploy. */
function alternatingPrepare(repo: RepoConfig): Deployable | DeployOutcome {
  if (repo.name === 'VastPayPwa' || repo.name === 'VastPay-DashBoard') {
    return { repo: repo.name, version: '—', status: 'failed', detail: 'promotion refused' };
  }
  return { repo, version: '2.0.0-rc1' };
}

/** Every repo checks out ready; promotion changes nothing. */
const allReady = {
  check: async (repo: RepoConfig): Promise<Deployable | DeployOutcome> => ({ repo, version: '2.0.0-rc1' }),
  promote: async (p: Deployable): Promise<Deployable | DeployOutcome> => p,
};

function released(repo: RepoConfig, version: string): DeployOutcome {
  return { repo: repo.name, version, status: 'released', detail: `${version} live on app` };
}

// The summary must read the way the command was typed, even though the
// launches and the finishes happen in two separate passes.
test('releaseMany returns outcomes in the order the repos were named', async () => {
  const outcomes = await releaseMany(targetsFor(FOUR), MANY_OPTIONS, {
    ...allReady,
    deploy: async (repo, _env, version) => {
      // Finishing in reverse order must not reorder the summary.
      await new Promise((r) => setTimeout(r, 5 * (FOUR.length - FOUR.indexOf(repo.name))));
      return released(repo, version);
    },
  });
  assert.deepEqual(
    outcomes.map((o) => o.repo),
    FOUR,
  );
});

// All or nothing: one repo that cannot go ahead stops every other one before
// anything is promoted or deployed (the release of three that quietly shipped
// two, 2026-10-14).
test('a repo refused at the check stops the whole release: nothing promoted, nothing deployed', async () => {
  const promoted: Array<[string, boolean]> = [];
  const deployed: string[] = [];
  const outcomes = await releaseMany(targetsFor(FOUR), MANY_OPTIONS, {
    check: async (repo) => alternatingPrepare(repo),
    promote: async (p, _o, dryRun) => {
      promoted.push([p.repo.name, dryRun]);
      return p;
    },
    deploy: async (repo, _env, version) => {
      deployed.push(repo.name);
      return released(repo, version);
    },
  });
  assert.deepEqual(deployed, []);
  assert.ok(promoted.every(([, dryRun]) => dryRun), 'only trial promotions ran');
  assert.deepEqual(
    outcomes.map((o) => [o.repo, o.status, o.detail]),
    [
      ['VastPayPwa', 'failed', 'promotion refused'],
      ['VastMenuPwa', 'skipped', 'not deployed — stopped by VastPayPwa, VastPay-DashBoard'],
      ['VastPay-DashBoard', 'failed', 'promotion refused'],
      ['VastMenu-DashBoard', 'skipped', 'not deployed — stopped by VastPayPwa, VastPay-DashBoard'],
    ],
  );
});

// The trial promotion is part of the check: a conflict in the last repo is
// found before the first repo is pushed.
test('a trial promotion that refuses stops the release before any real promotion', async () => {
  const real: string[] = [];
  const outcomes = await releaseMany(targetsFor(['VastPayPwa', 'VastMenuPwa']), MANY_OPTIONS, {
    check: allReady.check,
    promote: async (p, _o, dryRun) => {
      if (!dryRun) real.push(p.repo.name);
      if (p.repo.name === 'VastMenuPwa') {
        return { repo: p.repo.name, version: '—', status: 'failed', detail: 'promotion refused — develop → staging conflicts' };
      }
      return { ...p, promotion: { commits: 3, result: dryRun ? 'would merge' : 'merged' } };
    },
    deploy: async (repo, _env, version) => released(repo, version),
  });
  assert.deepEqual(real, []);
  assert.deepEqual(outcomes.map((o) => o.status), ['skipped', 'failed']);
});

// A benign skip (not cloned in a sweep) is not a refusal and stops nothing.
test('a repo skipped by a sweep does not stop the others', async () => {
  const outcomes = await releaseMany(targetsFor(['VastPayPwa', 'VastMenuPwa']), MANY_OPTIONS, {
    check: async (repo) => (repo.name === 'VastPayPwa' ? notClonedOutcome(repo.name, true) : { repo, version: '2.0.0-rc1' }),
    promote: allReady.promote,
    deploy: async (repo, _env, version) => released(repo, version),
  });
  assert.deepEqual(outcomes.map((o) => o.status), ['skipped', 'released']);
});

// A promotion can still fail for real after its trial passed (a push rejected
// in between). The rest are not promoted and nothing is deployed; a repo
// already promoted says so.
test('a real promotion that fails stops the remaining promotions and every deploy', async () => {
  const real: string[] = [];
  const deployed: string[] = [];
  const { events, seen } = recorder();
  const outcomes = await releaseMany(targetsFor(['VastPayPwa', 'VastMenuPwa', 'VastMenu-DashBoard']), MANY_OPTIONS, {
    check: allReady.check,
    promote: async (p, _o, dryRun) => {
      if (dryRun) return p;
      real.push(p.repo.name);
      if (p.repo.name === 'VastMenuPwa') {
        return { repo: p.repo.name, version: '—', status: 'failed', detail: 'promotion failed — push rejected' };
      }
      return { ...p, promotion: { commits: 2, result: 'merged' } };
    },
    deploy: async (repo, _env, version) => {
      deployed.push(repo.name);
      return released(repo, version);
    },
    events,
  });
  assert.deepEqual(real, ['VastPayPwa', 'VastMenuPwa']);
  assert.deepEqual(deployed, []);
  assert.deepEqual(
    outcomes.map((o) => [o.repo, o.status, o.detail]),
    [
      ['VastPayPwa', 'skipped', 'promoted, not deployed — stopped by VastMenuPwa'],
      ['VastMenuPwa', 'failed', 'promotion failed — push rejected'],
      ['VastMenu-DashBoard', 'skipped', 'not deployed — stopped by VastMenuPwa'],
    ],
  );
  // Every repo still gets exactly one plan and one done.
  for (const name of ['VastPayPwa', 'VastMenuPwa', 'VastMenu-DashBoard']) {
    const types = seen.filter((e) => 'repo' in e && e.repo === name).map((e) => e.type);
    assert.equal(types.filter((t) => t === 'plan').length, 1, name);
    assert.equal(types.filter((t) => t === 'done').length, 1, name);
  }
});

// Every repo still gets its done when a real promotion fails, including a
// benign skip after the failing repo (Vast Bar reads a missing done as a
// failure: "ended without finishing").
test('a failed real promotion still gives a later skipped repo its done', async () => {
  const { events, seen } = recorder();
  await releaseMany(targetsFor(['VastMenuPwa', 'VastPayPwa']), MANY_OPTIONS, {
    check: async (repo) => (repo.name === 'VastPayPwa' ? notClonedOutcome(repo.name, true) : { repo, version: '2.0.0-rc1' }),
    promote: async (p, _o, dryRun) =>
      dryRun ? p : { repo: p.repo.name, version: '—', status: 'failed', detail: 'promotion failed — push rejected' },
    deploy: async () => assert.fail('nothing deploys'),
    events,
  });
  const types = seen.filter((e) => 'repo' in e && e.repo === 'VastPayPwa').map((e) => e.type);
  assert.deepEqual(types, ['plan', 'done']);
});

test('repos after a failed real promotion plan as not promoted', async () => {
  const { events, seen } = recorder();
  await releaseMany(targetsFor(['VastMenuPwa', 'VastPayPwa']), MANY_OPTIONS, {
    check: allReady.check,
    promote: async (p, _o, dryRun) =>
      dryRun
        ? { ...p, promotion: { commits: 2, result: 'would merge' } }
        : { repo: p.repo.name, version: '—', status: 'failed', detail: 'promotion failed — push rejected' },
    deploy: async () => assert.fail('nothing deploys'),
    events,
  });
  const plan = seen.find((e) => e.type === 'plan' && e.repo === 'VastPayPwa');
  assert.ok(plan?.type === 'plan');
  assert.equal(plan.promote, 'not run');
});

test('a dry run never promotes for real', async () => {
  const calls: boolean[] = [];
  for (const names of [['VastMenuPwa'], ['VastMenuPwa', 'VastPayPwa']]) {
    await releaseMany(targetsFor(names), { ...MANY_OPTIONS, dryRun: true }, {
      check: allReady.check,
      promote: async (p, _o, dryRun) => {
        calls.push(dryRun);
        return p;
      },
      deploy: async (repo, _env, version) => ({ repo: repo.name, version, status: 'skipped', detail: 'dry run' }),
    });
  }
  assert.deepEqual(calls, [true, true, true]);
});

// The push guard: the trial must reach promote() as a dry run whatever the
// release's own --dry-run says, or a real release would push during its check.
test('promoteOne passes its own dryRun through, not the option', async () => {
  const seenDry: boolean[] = [];
  const deps = {
    promote: async (_r: RepoConfig, _d: string, dryRun: boolean) => {
      seenDry.push(dryRun);
      return true;
    },
  };
  const ready = { repo: getRepo('VastMenuPwa')!, version: '1.6.13-rc1' };
  const real = { ...MANY_OPTIONS, dryRun: false, dir: '/nonexistent/checkout' };
  await promoteOne(ready, real, true, deps);
  await promoteOne(ready, { ...real, dryRun: true }, false, deps);
  assert.deepEqual(seenDry, [true, false]);
});

// A backend repo has no develop: no trial, and it still deploys beside the others.
test('a repo with no develop is not trial-promoted and still deploys in a multi-repo release', async () => {
  const calls: Array<[string, boolean]> = [];
  const outcomes = await releaseMany(targetsFor(['VastPay-BackEnd', 'VastPayPwa']), MANY_OPTIONS, {
    check: allReady.check,
    promote: async (p, _o, dryRun) => {
      calls.push([p.repo.name, dryRun]);
      return p;
    },
    deploy: async (repo, _env, version) => released(repo, version),
  });
  assert.deepEqual(calls, [
    ['VastPayPwa', true],
    ['VastPay-BackEnd', false],
    ['VastPayPwa', false],
  ]);
  assert.deepEqual(outcomes.map((o) => o.status), ['released', 'released']);
});

// A real run's trial must not print "dry run — no merge performed": its lines
// are held back, and shown only when the trial refuses (they carry the conflicts).
test("a real run's trial prints nothing unless it refuses", async () => {
  const printed: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => void printed.push(args.join(' '));
  try {
    await releaseMany(targetsFor(['VastPayPwa', 'VastMenuPwa']), MANY_OPTIONS, {
      check: allReady.check,
      promote: async (p, _o, dryRun) => {
        if (!dryRun) return p;
        console.log(`trial ${p.repo.name}`);
        return p.repo.name === 'VastMenuPwa'
          ? { repo: p.repo.name, version: '—', status: 'failed', detail: 'promotion refused — conflicts:' }
          : p;
      },
      deploy: async () => assert.fail('nothing deploys'),
    });
  } finally {
    console.log = original;
  }
  assert.ok(!printed.includes('trial VastPayPwa'), 'a passing trial is silent');
  assert.ok(printed.includes('trial VastMenuPwa'), "a refusing trial's lines are shown");
});

// A dry run reports every refusal and says what the real run would do.
test('a dry run with a refused repo plans every repo and deploys nothing', async () => {
  const { events, seen } = recorder();
  const outcomes = await releaseMany(targetsFor(['VastPayPwa', 'VastMenuPwa']), { ...MANY_OPTIONS, dryRun: true }, {
    check: async (repo) => alternatingPrepare(repo),
    promote: async (p) => ({ ...p, promotion: { commits: 1, result: 'would merge' } }),
    deploy: async () => assert.fail('a stopped dry run deploys nothing'),
    events,
  });
  assert.deepEqual(
    outcomes.map((o) => [o.status, o.detail]),
    [
      ['failed', 'promotion refused'],
      ['skipped', 'would not deploy — stopped by VastPayPwa'],
    ],
  );
  const plans = seen.filter((e) => e.type === 'plan');
  assert.deepEqual(plans.map((e) => e.type === 'plan' && [e.repo, e.ok, e.commits]), [
    ['VastPayPwa', false, null],
    ['VastMenuPwa', true, 1],
  ]);
});

// One repo needs no trial: its real promotion refuses on its own, before
// anything is pushed.
test('a single repo is promoted once, for real', async () => {
  const calls: boolean[] = [];
  await releaseMany(targetsFor(['VastMenuPwa']), MANY_OPTIONS, {
    check: allReady.check,
    promote: async (p, _o, dryRun) => {
      calls.push(dryRun);
      return p;
    },
    deploy: async (repo, _env, version) => released(repo, version),
  });
  assert.deepEqual(calls, [false]);
});

test('several repos are trial-promoted, then promoted for real, in order', async () => {
  const calls: Array<[string, boolean]> = [];
  await releaseMany(targetsFor(['VastPayPwa', 'VastMenuPwa']), MANY_OPTIONS, {
    check: allReady.check,
    promote: async (p, _o, dryRun) => {
      calls.push([p.repo.name, dryRun]);
      return p;
    },
    deploy: async (repo, _env, version) => released(repo, version),
  });
  assert.deepEqual(calls, [
    ['VastPayPwa', true],
    ['VastMenuPwa', true],
    ['VastPayPwa', false],
    ['VastMenuPwa', false],
  ]);
});

test('--skip-promote runs no promotion at all, trial or real', async () => {
  const outcomes = await releaseMany(targetsFor(['VastPayPwa', 'VastMenuPwa']), { ...MANY_OPTIONS, skipPromote: true }, {
    check: allReady.check,
    promote: async () => assert.fail('--skip-promote must not promote'),
    deploy: async (repo, _env, version) => released(repo, version),
  });
  assert.deepEqual(outcomes.map((o) => o.status), ['released', 'released']);
});

// Everything a release deploys goes to staging. `release --to production` is
// refused at the command level, and nothing below it may quietly widen that.
test('releaseMany only ever deploys to staging', async () => {
  const envs: string[] = [];
  await releaseMany(targetsFor(FOUR), MANY_OPTIONS, {
    ...allReady,
    deploy: async (repo, env, version) => {
      envs.push(env);
      return released(repo, version);
    },
  });
  assert.deepEqual(envs, ['staging', 'staging', 'staging', 'staging']);
});

// Each deploying repo owns exactly one line of the board, numbered in prepare
// order, and every repo shares one board — two boards would each believe they
// own the cursor and overwrite each other's lines.
test('every deploying repo gets its own row on one shared board', async () => {
  const board: StatusBoard = { update: () => {} };
  const seen: Array<[string, number, number, unknown]> = [];
  await releaseMany(
    targetsFor(FOUR),
    MANY_OPTIONS,
    {
      ...allReady,
      deploy: async (repo, _env, version, _dryRun, slot) => {
        seen.push([repo.name, slot.row, slot.labelWidth, slot.board]);
        return released(repo, version);
      },
      board: () => board,
    },
  );
  assert.deepEqual(
    seen.map(([name, row]) => [name, row]),
    FOUR.map((name, row) => [name, row]),
  );
  // Padded to the longest in-flight name, so 'run 123' lines up across repos.
  assert.deepEqual(
    seen.map(([, , width]) => width),
    FOUR.map(() => 'VastMenu-DashBoard'.length),
  );
  assert.ok(
    seen.every(([, , , b]) => b === board),
    'every repo must write to the same board',
  );
});

test('a deploy that throws fails only its own repo', async () => {
  const outcomes = await releaseMany(targetsFor(FOUR), MANY_OPTIONS, {
    ...allReady,
    deploy: async (repo, _env, version) => {
      if (repo.name === 'VastMenuPwa') throw new Error('gh exploded');
      return released(repo, version);
    },
  });
  assert.deepEqual(
    outcomes.map((o) => [o.repo, o.status, o.detail]),
    [
      ['VastPayPwa', 'released', '2.0.0-rc1 live on app'],
      ['VastMenuPwa', 'failed', 'gh exploded'],
      ['VastPay-DashBoard', 'released', '2.0.0-rc1 live on app'],
      ['VastMenu-DashBoard', 'released', '2.0.0-rc1 live on app'],
    ],
  );
});

// --- the production version guard, which runs before anything is promoted ---

const DASH = (): RepoConfig => getRepo('VastMenu-DashBoard')!;
const PREP_OPTIONS: ReleaseOptions = { ...MANY_OPTIONS, dir: '/nonexistent/checkout' };

function prepDeps(staging: string, production: string, promoted: string[]) {
  return {
    stagingTag: async () => staging,
    readProduction: async () => production,
    promote: async (repo: RepoConfig) => {
      promoted.push(repo.name);
      return true;
    },
  };
}

// Shaped like VastMenu-DashBoard on 2026-10-01.
test('prepareOne refuses a version behind production and never promotes that repo', async () => {
  const promoted: string[] = [];
  const out = await prepareOne(DASH(), PREP_OPTIONS, prepDeps('2.1.12-rc30', '2.1.33', promoted));
  assert.ok('status' in out);
  assert.equal(out.status, 'failed');
  assert.match(out.detail, /2\.1\.12-rc31 is not above production 2\.1\.33/);
  assert.deepEqual(promoted, [], 'a refused repo must be left exactly as it was');
});

test('prepareOne with --fix-version ships the first version past production, noted', async () => {
  const promoted: string[] = [];
  const out = await prepareOne(
    DASH(),
    { ...PREP_OPTIONS, fixVersion: true },
    prepDeps('2.1.12-rc30', '2.1.33', promoted),
  );
  assert.ok(!('status' in out));
  assert.equal(out.version, '2.1.34-rc1');
  assert.equal(out.note, 'auto-corrected from 2.1.12-rc31 (production 2.1.33)');
  assert.deepEqual(promoted, ['VastMenu-DashBoard']);
});

test('prepareOne leaves a version above production alone', async () => {
  const promoted: string[] = [];
  const out = await prepareOne(DASH(), PREP_OPTIONS, prepDeps('2.1.34-rc1', '2.1.33', promoted));
  assert.ok(!('status' in out));
  assert.equal(out.version, '2.1.34-rc2');
  assert.equal(out.note, undefined);
});

test('a guard note reaches the summary line', async () => {
  const outcomes = await releaseMany([DASH()], MANY_OPTIONS, {
    check: async (repo) => ({ repo, version: '2.1.34-rc1', note: 'auto-corrected from 2.1.12-rc31 (production 2.1.33)' }),
    promote: allReady.promote,
    deploy: async (repo, _env, version) => released(repo, version),
  });
  assert.equal(outcomes[0].detail, '2.1.34-rc1 live on app · auto-corrected from 2.1.12-rc31 (production 2.1.33)');
});

test('--fix-version cannot be combined with --target-version', () => {
  assert.match(
    validateReleaseOptions(['VastPayPwa'], { ...opts({ targetVersion: '1.0.0-rc1' }), fixVersion: true }) ?? '',
    /mutually exclusive/,
  );
});

test('deployMany emits done for every repo it deploys, even one that throws', async () => {
  const seen: VastEvent[] = [];
  const [a, b] = targetsFor(['VastMenuPwa', 'VastMenu-DashBoard']);
  const outcomes = await deployMany([{ repo: a, version: '1.0.0-rc1' }, { repo: b, version: '2.0.0-rc1' }], 'staging', false, {
    board: () => ({ update: () => {} }),
    events: { emit: (e) => seen.push(e) },
    deploy: async (repo, _env, version) => {
      if (repo.name === 'VastMenu-DashBoard') throw new Error('boom');
      return released(repo, version);
    },
  });
  assert.deepEqual(outcomes.map((o) => o.status), ['released', 'failed']);
  assert.deepEqual(
    seen.filter((e) => e.type === 'done').map((e) => (e.type === 'done' ? `${e.repo}:${e.status}` : '')).sort(),
    ['VastMenu-DashBoard:failed', 'VastMenuPwa:released'],
  );
});

function recorder(): { events: { emit: (e: VastEvent) => void }; seen: VastEvent[] } {
  const seen: VastEvent[] = [];
  return { events: { emit: (e) => seen.push(e) }, seen };
}

test('a refused repo still reports its plan and its done', async () => {
  const { events, seen } = recorder();
  await releaseMany(targetsFor(['VastPayPwa', 'VastMenuPwa']), MANY_OPTIONS, {
    check: async (repo) => alternatingPrepare(repo),
    promote: allReady.promote,
    deploy: async (repo, _env, version) => released(repo, version),
    board: () => ({ update: () => {} }),
    events,
  });
  const forPwa = seen.filter((e) => 'repo' in e && e.repo === 'VastPayPwa').map((e) => e.type);
  assert.deepEqual(forPwa, ['plan', 'done']);
  const plan = seen.find((e) => e.type === 'plan' && e.repo === 'VastPayPwa');
  assert.deepEqual(plan, {
    type: 'plan',
    repo: 'VastPayPwa',
    ok: false,
    version: '—',
    commits: null,
    promote: 'not run',
    notice: null,
    detail: 'promotion refused',
  });
});

test('a promoted repo reports plan, promoted, then its deploy', async () => {
  const { events, seen } = recorder();
  await releaseMany(targetsFor(['VastMenuPwa']), MANY_OPTIONS, {
    check: async (repo) => ({ repo, version: '1.6.13-rc1' }),
    promote: async (p) => ({ ...p, promotion: { commits: 4, result: 'merged' } }),
    deploy: async (repo, _env, version) => released(repo, version),
    board: () => ({ update: () => {} }),
    events,
  });
  assert.deepEqual(seen.map((e) => e.type), ['plan', 'promoted', 'done']);
  assert.deepEqual(seen[1], { type: 'promoted', repo: 'VastMenuPwa', commits: 4 });
});

test('a plan names the guard notice and the promotion state', () => {
  const repo = getRepo('VastMenuPwa')!;
  assert.deepEqual(
    planEvent(repo, {
      repo,
      version: '1.6.13-rc1',
      note: 'auto-corrected past production',
      notice: { tone: 'warn', text: '1.6.10-rc16 is not above production 1.6.12 — using 1.6.13-rc1' },
      promotion: { commits: 2, result: 'would merge' },
    }),
    {
      type: 'plan',
      repo: 'VastMenuPwa',
      ok: true,
      version: '1.6.13-rc1',
      commits: 2,
      promote: 'will merge',
      notice: '1.6.10-rc16 is not above production 1.6.12 — using 1.6.13-rc1',
      detail: 'auto-corrected past production',
    },
  );
  const backend = getRepo('VastPay-BackEnd')!;
  assert.equal((planEvent(backend, { repo: backend, version: '4.5.11-rc31' }) as { promote: string }).promote, 'no develop');
});

test('runRelease brackets the stream with start and end, and returns the exit code', async () => {
  const { events, seen } = recorder();
  const code = await runRelease(['VastMenuPwa'], { ...MANY_OPTIONS, dryRun: true }, events, ['release', 'VastMenuPwa', '--dry-run', '--json'], {
    check: async (repo) => ({ repo, version: '1.6.13-rc1' }),
    promote: allReady.promote,
    deploy: async (repo, _env, version) => ({ repo: repo.name, version, status: 'skipped', detail: 'dry run' }),
    board: () => ({ update: () => {} }),
  });
  assert.equal(code, 0);
  assert.equal(seen[0].type, 'start');
  assert.deepEqual(seen[0], {
    type: 'start',
    command: 'release',
    args: ['release', 'VastMenuPwa', '--dry-run', '--json'],
    dryRun: true,
    repos: ['VastMenuPwa'],
  });
  assert.equal(seen.at(-1)?.type, 'done');
});

test('an unknown repository is exit code 1 with no repo events', async () => {
  const { events, seen } = recorder();
  const code = await runRelease(['Nope'], MANY_OPTIONS, events, ['release', 'Nope'], {});
  assert.equal(code, 1);
  assert.deepEqual(seen, []);
});

// --- a throw never cuts the stream ---

test('a check that throws refuses its repo and stops the rest: plan and done for both, then end', async () => {
  const { events, seen } = recorder();
  const code = await streamToEnd(events, () =>
    runRelease(['VastPayPwa', 'VastMenuPwa'], MANY_OPTIONS, events, ['release', 'VastPayPwa', 'VastMenuPwa', '--json'], {
      check: async (repo) => {
        if (repo.name === 'VastPayPwa') throw new Error('Command failed: git fetch --prune origin\nfatal: unable to access');
        return { repo, version: '1.6.13-rc1' };
      },
      promote: allReady.promote,
      deploy: async (repo, _env, version) => released(repo, version),
      board: () => ({ update: () => {} }),
    }),
  );
  assert.equal(code, 1);
  assert.deepEqual(
    seen.map((e) => ('repo' in e ? `${e.type}:${e.repo}` : e.type)),
    ['start', 'plan:VastPayPwa', 'done:VastPayPwa', 'plan:VastMenuPwa', 'done:VastMenuPwa', 'end'],
  );
  const done = seen[2];
  assert.ok(done.type === 'done');
  assert.equal(done.status, 'failed');
  assert.equal(done.detail, 'Command failed: git fetch --prune origin', 'the first line only');
  assert.deepEqual(seen.at(-1), { type: 'end', exitCode: 1 });
});

test('prepareOne turns a promotion that throws into a failed outcome for that repo', async () => {
  const out = await prepareOne(getRepo('VastMenuPwa')!, PREP_OPTIONS, {
    stagingTag: async () => '1.6.13-rc1',
    readProduction: async () => '1.6.12',
    promote: async () => {
      throw new Error('Command failed: git push origin staging\n! [rejected] staging -> staging (fetch first)');
    },
  });
  assert.deepEqual(out, {
    repo: 'VastMenuPwa',
    version: '—',
    status: 'failed',
    detail: 'promotion failed — Command failed: git push origin staging',
  });
});

test('a board that throws still gives the planned repo its done, then end with exit code 1', async () => {
  const { events, seen } = recorder();
  const code = await streamToEnd(events, () =>
    runRelease(['VastMenuPwa'], MANY_OPTIONS, events, [], {
      check: async (repo) => ({ repo, version: '1.6.13-rc1' }),
    promote: allReady.promote,
      deploy: async (repo, _env, version) => released(repo, version),
      board: () => {
        throw new Error('no terminal');
      },
    }),
  );
  assert.equal(code, 1);
  assert.deepEqual(seen.map((e) => e.type), ['start', 'plan', 'done', 'end']);
  assert.deepEqual(seen.at(-1), { type: 'end', exitCode: 1 });
});

test('a sink that throws on every event cannot lose any repo of a release', async () => {
  const outcomes = await releaseMany(targetsFor(FOUR), MANY_OPTIONS, {
    ...allReady,
    deploy: async (repo, _env, version) => released(repo, version),
    board: () => ({ update: () => {} }),
    events: {
      emit: () => {
        throw new Error('EPIPE');
      },
    },
  });
  assert.deepEqual(outcomes.map((o) => o.status), ['released', 'released', 'released', 'released']);
});

test('a benign skip plans ok; only a failure is a refusal', () => {
  const repo = getRepo('VastPayPwa')!;
  const skipped = planEvent(repo, notClonedOutcome('VastPayPwa', true));
  assert.ok(skipped.type === 'plan' && skipped.ok === true);
  const failed = planEvent(repo, notClonedOutcome('VastPayPwa', false));
  assert.ok(failed.type === 'plan' && failed.ok === false);
});

// In --json mode the board draws on stderr, so stderr — not stdout — decides
// whether it is live. The test runner's stdout is a pipe either way.
test('the board is live when the stream it draws on is a terminal', async () => {
  const [a] = targetsFor(['VastMenuPwa']);
  const heartbeats: number[] = [];
  const written: string[] = [];
  for (const isTTY of [true, false]) {
    await deployMany([{ repo: a, version: '1.0.0-rc1' }], 'staging', true, {
      stream: { isTTY, columns: 80, write: (chunk: string) => written.push(chunk) },
      deploy: async (repo, _env, version, _dryRun, _slot, timing) => {
        heartbeats.push(timing.heartbeatMs);
        return released(repo, version);
      },
    });
  }
  assert.deepEqual(heartbeats, [pollTimingFor(1, true).heartbeatMs, pollTimingFor(1, false).heartbeatMs]);
  assert.notEqual(heartbeats[0], heartbeats[1]);
  assert.ok(written.includes('\n'), 'the live board reserved its row on that stream');
});
