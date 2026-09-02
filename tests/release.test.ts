import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pollIntervalFor,
  releaseMany,
  releaseTargets,
  validateReleaseOptions,
  type InFlight,
  type ReleaseOptions,
} from '../src/commands/release.js';
import { notClonedOutcome, type DeployOutcome } from '../src/commands/deploy.js';
import { getRepo, type RepoConfig } from '../src/config/repos.js';

// Regression: `vast release --all` must never include an unreleasable repo.
// It previously iterated the raw REPOS list, so an unreleasable repo
// (Terraform, vastpay-payment-odoo, Vast-Finance) that simply was not cloned
// yet produced a 'failed' outcome and took process.exit(1) down with it.
test('--all targets only releasable repos', () => {
  const names = releaseTargets([], true).repos.map((r) => r.name);
  assert.ok(!names.includes('Terraform'), 'Terraform is not releasable and must not be a target');
  assert.ok(
    !names.includes('vastpay-payment-odoo'),
    'vastpay-payment-odoo is not releasable and must not be a target',
  );
  assert.ok(!names.includes('Vast-Finance'), 'Vast-Finance is not releasable and must not be a target');
  assert.ok(names.includes('VastPayPwa'), 'a releasable repo must still be a target');
});

test('a named repo is targeted regardless of releasability', () => {
  const names = releaseTargets(['Terraform'], false).repos.map((r) => r.name);
  assert.deepEqual(names, ['Terraform']);
});

test('an unknown repo name targets nothing and is reported', () => {
  const { repos, unknown } = releaseTargets(['NotARepo'], false);
  assert.deepEqual(repos, []);
  assert.deepEqual(unknown, ['NotARepo']);
});

// `vast release A B` releases both. Names resolve to their canonical spelling
// and keep the order they were typed in, so the output reads top to bottom
// the way the user thinks about it.
test('several names resolve to canonical configs in the order given', () => {
  const names = releaseTargets(['Vastmenu-Dashboard', 'Vastpay-Dashboard'], false).repos.map(
    (r) => r.name,
  );
  assert.deepEqual(names, ['VastMenu-DashBoard', 'VastPay-DashBoard']);
});

test('the same repo named twice, in any casing, is one target', () => {
  const names = releaseTargets(['VastPayPwa', 'vastpaypwa'], false).repos.map((r) => r.name);
  assert.deepEqual(names, ['VastPayPwa']);
});

test('every unknown name is reported while the known ones still resolve', () => {
  const { repos, unknown } = releaseTargets(['VastPayPwa', 'Nope', 'Nada'], false);
  assert.deepEqual(
    repos.map((r) => r.name),
    ['VastPayPwa'],
  );
  assert.deepEqual(unknown, ['Nope', 'Nada']);
});

// Option validation runs before anything is touched: a bad combination must
// refuse the whole command, never release the first repo and then complain.
test('--all together with names is refused', () => {
  assert.match(validateReleaseOptions(['VastPayPwa'], { all: true }) ?? '', /--all/);
});

test('--target-version is per-repo, so it is refused with more than one repo', () => {
  const err = validateReleaseOptions(['VastPayPwa', 'VastMenuPwa'], {
    all: false,
    targetVersion: '1.2.3',
  });
  assert.match(err ?? '', /--target-version/);
  assert.equal(validateReleaseOptions(['VastPayPwa'], { all: false, targetVersion: '1.2.3' }), null);
});

test('--dir names one checkout, so it is refused with more than one repo', () => {
  const err = validateReleaseOptions(['VastPayPwa', 'VastMenuPwa'], { all: false, dir: '/tmp/x' });
  assert.match(err ?? '', /--dir/);
  assert.equal(validateReleaseOptions(['VastPayPwa'], { all: false, dir: '/tmp/x' }), null);
});

test('--bump and --target-version are mutually exclusive', () => {
  const err = validateReleaseOptions(['VastPayPwa'], {
    all: false,
    bump: 'minor',
    targetVersion: '1.2.3',
  });
  assert.match(err ?? '', /mutually exclusive/);
});

test('an unknown --bump level is refused', () => {
  assert.match(validateReleaseOptions(['VastPayPwa'], { all: false, bump: 'huge' }) ?? '', /--bump/);
});

test('several repos with --bump is a valid combination', () => {
  assert.equal(
    validateReleaseOptions(['VastPayPwa', 'VastMenuPwa'], { all: false, bump: 'minor' }),
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
  assert.match(validateReleaseOptions([], { all: true, dir: '/tmp/x' }) ?? '', /--dir/);
});

test('--all is refused with --target-version', () => {
  assert.match(
    validateReleaseOptions([], { all: true, targetVersion: '1.2.3' }) ?? '',
    /--target-version/,
  );
});

test('one repo named twice in different casing still accepts --target-version', () => {
  assert.equal(
    validateReleaseOptions(['VastPayPwa', 'vastpaypwa'], { all: false, targetVersion: '1.2.3' }),
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

const MANY_OPTIONS: ReleaseOptions = {
  to: 'staging',
  dryRun: false,
  skipPromote: false,
  all: false,
};

const FOUR = ['VastPayPwa', 'VastMenuPwa', 'VastPay-DashBoard', 'VastMenu-DashBoard'];

function targetsFor(names: string[]): RepoConfig[] {
  return names.map((n) => getRepo(n)!);
}

/** A and C refuse at launch; B and D dispatch a run. */
function alternatingLaunch(repo: RepoConfig): InFlight | DeployOutcome {
  if (repo.name === 'VastPayPwa' || repo.name === 'VastPay-DashBoard') {
    return { repo: repo.name, version: '—', status: 'failed', detail: 'promotion refused' };
  }
  return { repo, version: '2.0.0-rc1', runId: 100 };
}

function released(flight: InFlight): DeployOutcome {
  return { repo: flight.repo.name, version: flight.version, status: 'released', detail: 'PR #1' };
}

// The summary must read the way the command was typed, even though the
// launches and the finishes happen in two separate passes.
test('releaseMany returns outcomes in the order the repos were named', async () => {
  const outcomes = await releaseMany(targetsFor(FOUR), MANY_OPTIONS, {
    launch: async (repo) => alternatingLaunch(repo),
    finish: async (flight) => released(flight),
  });
  assert.deepEqual(
    outcomes.map((o) => [o.repo, o.status]),
    [
      ['VastPayPwa', 'failed'],
      ['VastMenuPwa', 'released'],
      ['VastPay-DashBoard', 'failed'],
      ['VastMenu-DashBoard', 'released'],
    ],
  );
});

// One repo refusing never stops another: the repos that did dispatch are all
// still watched.
test('a repo that fails to launch does not stop the others being finished', async () => {
  const finished: string[] = [];
  await releaseMany(targetsFor(FOUR), MANY_OPTIONS, {
    launch: async (repo) => alternatingLaunch(repo),
    finish: async (flight) => {
      finished.push(flight.repo.name);
      return released(flight);
    },
  });
  assert.deepEqual(finished.sort(), ['VastMenu-DashBoard', 'VastMenuPwa']);
});

test('a finish that throws fails only its own repo', async () => {
  const outcomes = await releaseMany(targetsFor(FOUR), MANY_OPTIONS, {
    launch: async (repo) => alternatingLaunch(repo),
    finish: async (flight) => {
      if (flight.repo.name === 'VastMenuPwa') throw new Error('gh exploded');
      return released(flight);
    },
  });
  assert.deepEqual(
    outcomes.map((o) => [o.repo, o.status, o.detail]),
    [
      ['VastPayPwa', 'failed', 'promotion refused'],
      ['VastMenuPwa', 'failed', 'gh exploded'],
      ['VastPay-DashBoard', 'failed', 'promotion refused'],
      ['VastMenu-DashBoard', 'released', 'PR #1'],
    ],
  );
});
