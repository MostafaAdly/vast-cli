import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { VastEvent } from '../src/utils/events.js';
import type { AnnounceDeps } from '../src/commands/promote.js';

process.env.VAST_CLI_HOME = mkdtempSync(join(tmpdir(), 'vast-report-home-'));
const { promote, runPromote } = await import('../src/commands/promote.js');
const { streamToEnd } = await import('../src/utils/events.js');
const { buildReleaseMessage } = await import('../src/utils/release-message.js');
const { newReport } = await import('../src/utils/promotion-report.js');
const { getRepo } = await import('../src/config/repos.js');

/** A clone with a real origin holding develop, staging and production. */
function fixture(developAhead: number): { clone: string; cleanup: () => void } {
  const base = mkdtempSync(join(tmpdir(), 'vast-report-'));
  const upstream = join(base, 'upstream');
  const clone = join(base, 'clone');
  const git = (dir: string, ...args: string[]): string =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf-8', stdio: 'pipe' });
  execFileSync('git', ['init', '-q', '-b', 'production', upstream], { stdio: 'pipe' });
  git(upstream, 'config', 'user.email', 't@e.com');
  git(upstream, 'config', 'user.name', 'T');
  writeFileSync(join(upstream, 'f.txt'), 'base\n');
  git(upstream, 'add', '.');
  git(upstream, 'commit', '-qm', 'base');
  git(upstream, 'branch', 'staging');
  git(upstream, 'checkout', '-qb', 'develop');
  for (let i = 0; i < developAhead; i++) {
    writeFileSync(join(upstream, `d${i}.txt`), `${i}\n`);
    git(upstream, 'add', '.');
    git(upstream, 'commit', '-qm', `feat: d${i}`);
  }
  git(upstream, 'checkout', '-q', 'production');
  execFileSync('git', ['clone', '-q', upstream, clone], { stdio: 'pipe' });
  git(clone, 'config', 'user.email', 't@e.com');
  git(clone, 'config', 'user.name', 'T');
  return { clone, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

const REPO = getRepo('VastPayPwa')!;

test('a dry-run staging promotion reports the commits it would merge', async () => {
  const f = fixture(2);
  try {
    const report = newReport();
    assert.equal(await promote(REPO, f.clone, 'staging', true, 'release', undefined, 'changelog', [], false, report), true);
    assert.deepEqual(report, { commits: 2, result: 'would merge' });
  } finally {
    f.cleanup();
  }
});

test('a staging promotion with nothing new reports nothing to promote', async () => {
  const f = fixture(0);
  try {
    const report = newReport();
    assert.equal(await promote(REPO, f.clone, 'staging', true, 'release', undefined, 'changelog', [], false, report), true);
    assert.deepEqual(report, { commits: 0, result: 'nothing to promote' });
  } finally {
    f.cleanup();
  }
});

test('a refused promotion records why', async () => {
  const f = fixture(1);
  try {
    writeFileSync(join(f.clone, 'dirty.txt'), 'uncommitted\n');
    const report = newReport();
    assert.equal(await promote(REPO, f.clone, 'staging', true, 'release', undefined, 'changelog', [], false, report), false);
    assert.equal(report.result, 'refused');
    assert.equal(report.error, 'VastPayPwa has uncommitted changes: Commit or stash them before promoting.');
  } finally {
    f.cleanup();
  }
});

const BASE_OPTS = { to: 'staging', changelog: true, dryRun: true } as const;

test('runPromote brackets a promotion with start, plan and done', async () => {
  const f = fixture(2);
  try {
    const seen: VastEvent[] = [];
    const code = await runPromote('VastPayPwa', { ...BASE_OPTS, dir: f.clone }, { emit: (e) => seen.push(e) }, [
      'promote',
      'VastPayPwa',
      '--dry-run',
      '--json',
    ]);
    assert.equal(code, 0);
    assert.deepEqual(seen.map((e) => e.type), ['start', 'plan', 'done']);
    assert.deepEqual(seen[1], {
      type: 'plan',
      repo: 'VastPayPwa',
      ok: true,
      version: '—',
      commits: 2,
      promote: 'will merge',
      notice: null,
      detail: null,
    });
    assert.deepEqual(seen[2], { type: 'done', repo: 'VastPayPwa', version: '—', status: 'skipped', detail: 'dry run' });
  } finally {
    f.cleanup();
  }
});

test('runPromote on an unknown repository is exit 1 with no events', async () => {
  const seen: VastEvent[] = [];
  assert.equal(await runPromote('Nope', BASE_OPTS, { emit: (e) => seen.push(e) }, ['promote', 'Nope']), 1);
  assert.deepEqual(seen, []);
});

test('a refused promotion is done/failed with the reason', async () => {
  const f = fixture(1);
  try {
    writeFileSync(join(f.clone, 'dirty.txt'), 'x\n');
    const seen: VastEvent[] = [];
    const code = await runPromote('VastPayPwa', { ...BASE_OPTS, dir: f.clone }, { emit: (e) => seen.push(e) }, []);
    assert.equal(code, 1);
    assert.deepEqual(seen.at(-1), {
      type: 'done',
      repo: 'VastPayPwa',
      version: '—',
      status: 'failed',
      detail: 'VastPayPwa has uncommitted changes: Commit or stash them before promoting.',
    });
  } finally {
    f.cleanup();
  }
});

/**
 * A clone whose origin has staging `stagingAhead` commits past production, each
 * rewriting f.txt. With `conflict`, production rewrote f.txt too, so the
 * staging → production merge (and a pick of staging's commit) conflicts.
 */
function productionFixture(
  stagingAhead: number,
  conflict = false,
): { clone: string; stagingSha: string; cleanup: () => void } {
  const base = mkdtempSync(join(tmpdir(), 'vast-report-prod-'));
  const upstream = join(base, 'upstream');
  const clone = join(base, 'clone');
  const git = (dir: string, ...args: string[]): string =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf-8', stdio: 'pipe' });
  execFileSync('git', ['init', '-q', '-b', 'production', upstream], { stdio: 'pipe' });
  git(upstream, 'config', 'user.email', 't@e.com');
  git(upstream, 'config', 'user.name', 'T');
  writeFileSync(join(upstream, 'f.txt'), 'base\n');
  git(upstream, 'add', '.');
  git(upstream, 'commit', '-qm', 'base');
  git(upstream, 'branch', 'staging');
  if (conflict) {
    writeFileSync(join(upstream, 'f.txt'), 'production\n');
    git(upstream, 'commit', '-qam', 'fix: on production');
  }
  git(upstream, 'checkout', '-q', 'staging');
  for (let i = 0; i < stagingAhead; i++) {
    writeFileSync(join(upstream, 'f.txt'), `staging ${i}\n`);
    git(upstream, 'commit', '-qam', `feat: s${i}`);
  }
  const stagingSha = git(upstream, 'rev-parse', 'HEAD').trim();
  git(upstream, 'checkout', '-q', 'production');
  execFileSync('git', ['clone', '-q', upstream, clone], { stdio: 'pipe' });
  git(clone, 'config', 'user.email', 't@e.com');
  git(clone, 'config', 'user.name', 'T');
  return { clone, stagingSha, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

// An explicit version and a dry run keep these offline: no deployedTag read,
// and the cut returns before any gh call.
test('a dry-run production promotion reports the PR it would open', async () => {
  const f = productionFixture(1);
  try {
    const report = newReport();
    assert.equal(await promote(REPO, f.clone, 'production', true, 'release', '1.2.3', 'bare', [], false, report), true);
    assert.deepEqual(report, {
      commits: 1,
      result: 'would open pr',
      version: '1.2.3',
      kind: 'release',
      branch: 'release/1.2.3',
      url: null,
    });
  } finally {
    f.cleanup();
  }
});

test('a production promotion with staging already in production has nothing to promote', async () => {
  const f = productionFixture(0);
  try {
    const report = newReport();
    assert.equal(await promote(REPO, f.clone, 'production', true, 'release', '1.2.3', 'bare', [], false, report), true);
    assert.deepEqual(report, { commits: 0, result: 'nothing to promote' });
  } finally {
    f.cleanup();
  }
});

// The exit code of a dry run is unchanged (true, exit 0); the report is what
// tells the app the real run would refuse.
test('a dry run whose staging → production merge conflicts reports a refusal, not a PR it would open', async () => {
  const f = productionFixture(1, true);
  try {
    const report = newReport();
    assert.equal(await promote(REPO, f.clone, 'production', true, 'release', '1.2.3', 'bare', [], false, report), true);
    assert.equal(report.result, 'refused');
    assert.equal(report.error, 'staging → production conflicts in 1 file(s): f.txt');
    assert.equal(report.url, null);
  } finally {
    f.cleanup();
  }
});

// The real run refuses at the same trial merge, before any checkout, push or gh.
test('a real run whose cut refuses names the conflict, not just the branch', async () => {
  const f = productionFixture(1, true);
  try {
    const report = newReport();
    assert.equal(await promote(REPO, f.clone, 'production', false, 'release', '1.2.3', 'bare', [], false, report), false);
    assert.equal(report.result, 'refused');
    assert.equal(report.error, 'staging → production conflicts in 1 file(s): f.txt');
  } finally {
    f.cleanup();
  }
});

// A pick conflict is only found by applying it, so this is a real run: it cuts
// the branch locally, the cherry-pick conflicts, and it rolls back before any
// push or gh call.
test('a real pick run that conflicts names the pick that conflicted', async () => {
  const f = productionFixture(1, true);
  try {
    const report = newReport();
    const ok = await promote(REPO, f.clone, 'production', false, 'hotfix', '1.2.4', 'bare', [f.stagingSha], false, report);
    assert.equal(ok, false);
    assert.equal(report.result, 'refused');
    assert.equal(report.branch, 'hotfix/1.2.4');
    assert.equal(report.error, `pick ${f.stagingSha.slice(0, 7)} (feat: s0) conflicts: f.txt`);
  } finally {
    f.cleanup();
  }
});

test('runPromote streams a dry-run conflict as a failed promotion, exit code unchanged at 0', async () => {
  const f = productionFixture(1, true);
  try {
    const seen: VastEvent[] = [];
    const code = await runPromote(
      'VastPayPwa',
      { to: 'production', changelog: false, dryRun: true, targetVersion: '1.2.3', dir: f.clone },
      { emit: (e) => seen.push(e) },
      [],
    );
    assert.equal(code, 0, 'a dry run exits 0, as it did before --json');
    assert.deepEqual(seen.map((e) => e.type), ['start', 'plan', 'done'], 'no pr event for a PR that would not open');
    const plan = seen[1];
    assert.ok(plan.type === 'plan' && plan.ok === false);
    assert.equal(plan.detail, 'staging → production conflicts in 1 file(s): f.txt');
    assert.deepEqual(seen.at(-1), {
      type: 'done',
      repo: 'VastPayPwa',
      version: '1.2.3',
      status: 'failed',
      detail: 'staging → production conflicts in 1 file(s): f.txt',
    });
  } finally {
    f.cleanup();
  }
});

test('a promotion that throws still ends with plan and done, exit 1', async () => {
  const f = fixture(1);
  try {
    // A push that cannot reach origin throws out of mergeAndPush.
    execFileSync('git', ['remote', 'set-url', '--push', 'origin', join(f.clone, 'no-such-remote')], {
      cwd: f.clone,
      stdio: 'pipe',
    });
    const seen: VastEvent[] = [];
    const code = await runPromote('VastPayPwa', { ...BASE_OPTS, dryRun: false, dir: f.clone }, { emit: (e) => seen.push(e) }, []);
    assert.equal(code, 1);
    assert.deepEqual(seen.map((e) => e.type), ['start', 'plan', 'done']);
    const plan = seen[1];
    assert.ok(plan.type === 'plan' && plan.ok === false && plan.commits === 1 && plan.detail);
    const done = seen[2];
    assert.ok(done.type === 'done' && done.status === 'failed' && done.detail.length > 0);
    assert.ok(!done.detail.includes('\n'), 'a thrown error reaches done as its first line only');
    assert.match(done.detail, /^Command failed: git/);
  } finally {
    f.cleanup();
  }
});

test('a production dry run streams the PR it would open', async () => {
  const f = productionFixture(1);
  try {
    const seen: VastEvent[] = [];
    const code = await streamToEnd({ emit: (e) => seen.push(e) }, () =>
      runPromote(
        'VastPayPwa',
        { to: 'production', changelog: false, dryRun: true, targetVersion: '1.2.3', dir: f.clone },
        { emit: (e) => seen.push(e) },
        [],
      ),
    );
    assert.equal(code, 0);
    assert.deepEqual(seen.map((e) => e.type), ['start', 'plan', 'pr', 'done', 'end']);
    assert.deepEqual(seen[1], {
      type: 'plan',
      repo: 'VastPayPwa',
      ok: true,
      version: '1.2.3',
      commits: 1,
      promote: 'not run',
      notice: null,
      detail: null,
    });
    assert.deepEqual(seen[2], {
      type: 'pr',
      repo: 'VastPayPwa',
      branch: 'release/1.2.3',
      url: null,
      version: '1.2.3',
      slack: null,
    });
    assert.deepEqual(seen[3], { type: 'done', repo: 'VastPayPwa', version: '1.2.3', status: 'skipped', detail: 'dry run' });
  } finally {
    f.cleanup();
  }
});

test('a --slack dry run carries the message in pr.slack and posts nothing', async () => {
  const f = productionFixture(1);
  try {
    const posted: string[] = [];
    const deps: AnnounceDeps = {
      readSlackToken: () => null,
      readSlackChannel: () => null,
      slackUserOverride: () => null,
      lookupUserByEmail: async () => null,
      postMessage: async (_token, channel, text) => {
        posted.push(text);
        return { ts: '1.2', channel };
      },
      shippedPrs: async () => [],
      summarizePrs: async () => ({}),
      buildReleaseMessage,
    };
    const seen: VastEvent[] = [];
    const code = await runPromote(
      'VastPayPwa',
      { to: 'production', changelog: false, slack: true, dryRun: true, targetVersion: '1.2.3', dir: f.clone },
      { emit: (e) => seen.push(e) },
      [],
      deps,
    );
    assert.equal(code, 0);
    const pr = seen.find((e) => e.type === 'pr');
    assert.ok(pr && pr.type === 'pr');
    assert.ok(pr.slack, 'a --slack run has a Slack result');
    assert.ok(pr.slack.text.length > 0, 'the message text rides in the event');
    assert.equal(pr.slack.posted, false);
    assert.equal(pr.slack.error, null);
    assert.deepEqual(posted, [], 'a dry run never posts');
  } finally {
    f.cleanup();
  }
});

// The Slack preview is exactly what it was before the report existed: a dry
// run that would conflict still shows the message it would post.
test('a --slack dry run that would conflict still prints its preview, exit 0', async () => {
  const f = productionFixture(1, true);
  try {
    let built = 0;
    const deps: AnnounceDeps = {
      readSlackToken: () => null,
      readSlackChannel: () => null,
      slackUserOverride: () => null,
      lookupUserByEmail: async () => null,
      postMessage: async () => {
        throw new Error('a dry run must not post');
      },
      shippedPrs: async () => [],
      summarizePrs: async () => ({}),
      buildReleaseMessage: (input) => {
        built++;
        return buildReleaseMessage(input);
      },
    };
    const seen: VastEvent[] = [];
    const code = await runPromote(
      'VastPayPwa',
      { to: 'production', changelog: false, slack: true, dryRun: true, targetVersion: '1.2.3', dir: f.clone },
      { emit: (e) => seen.push(e) },
      [],
      deps,
    );
    assert.equal(code, 0);
    assert.equal(built, 1, 'the dry-run preview was built');
    assert.deepEqual(seen.map((e) => e.type), ['start', 'plan', 'done']);
  } finally {
    f.cleanup();
  }
});

// announceRelease catches every Slack failure itself, so this throw comes from
// an injected dep: what matters is that a throw after the cut was recorded
// keeps the cut's result, rather than turning a good PR into a refusal.
test('a throw after the cut keeps the plan ok and the pr event; only the exit code says it threw', async () => {
  const f = productionFixture(1);
  try {
    const deps: AnnounceDeps = {
      readSlackToken: () => null,
      readSlackChannel: () => null,
      slackUserOverride: () => null,
      lookupUserByEmail: async () => null,
      postMessage: async () => {
        throw new Error('a dry run must not post');
      },
      shippedPrs: async () => {
        throw new Error('gh exploded\nwith a second line');
      },
      summarizePrs: async () => ({}),
      buildReleaseMessage,
    };
    const seen: VastEvent[] = [];
    const code = await runPromote(
      'VastPayPwa',
      { to: 'production', changelog: false, slack: true, dryRun: true, targetVersion: '1.2.3', dir: f.clone },
      { emit: (e) => seen.push(e) },
      [],
      deps,
    );
    assert.equal(code, 1);
    assert.deepEqual(seen.map((e) => e.type), ['start', 'plan', 'pr', 'done']);
    const plan = seen[1];
    assert.ok(plan.type === 'plan' && plan.ok === true && plan.detail === null);
    const pr = seen[2];
    assert.ok(pr.type === 'pr' && pr.branch === 'release/1.2.3' && pr.slack === null);
    assert.deepEqual(seen[3], { type: 'done', repo: 'VastPayPwa', version: '1.2.3', status: 'skipped', detail: 'dry run' });
  } finally {
    f.cleanup();
  }
});
