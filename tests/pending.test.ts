import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Parity, PrUnit } from '../src/utils/parity.js';

// Before any import that reads config: a test must never touch ~/.vast-cli.
process.env.VAST_CLI_HOME = mkdtempSync(join(tmpdir(), 'vast-pending-home-'));
const { runPending, parseOpenReleasePrs } = await import('../src/commands/pending.js');
type Deps = import('../src/commands/pending.js').PendingDeps;
type Opts = import('../src/commands/pending.js').PendingOptions;

const unit = (number: number): PrUnit => ({
  number,
  branch: `fix/change-${number}`,
  sha: `sha${number}`,
  landedAt: new Date('2026-09-20T00:00:00Z'),
  patchId: null,
});

const parityOf = (src: number[], tgt: number[] = []): Parity => ({
  source: 'origin/staging',
  target: 'origin/production',
  onlySource: { prs: src.map(unit), direct: [], ported: new Set() },
  onlyTarget: { prs: tgt.map(unit), direct: [], ported: new Set() },
  sharedPrs: [],
});

function fake(over: Partial<Deps> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const posted: unknown[][] = [];
  const calls = { phrases: 0 };
  const deps: Deps = {
    repoDir: () => '/checkout',
    isCheckout: () => true,
    fetchBranches: async () => true,
    compareBranches: () => parityOf([301, 313]),
    prNumbersInRange: () => [301],
    lookupPr: async (_repo, n) => ({
      title: `fix: change ${n}`,
      url: `https://github.com/Vast-menu/VastPayPwaV2/pull/${n}`,
      branch: `fix/change-${n}`,
      contributors: [{ name: 'Osama Elshimy', login: null, emails: ['o@e.com'] }],
    }),
    openReleasePrs: async () => [
      { number: 334, url: 'https://github.com/Vast-menu/VastPayPwaV2/pull/334', branch: 'hotfix/2.1.15' },
    ],
    modelPhrases: async (prs) => {
      calls.phrases++;
      return Object.fromEntries(prs.map((p) => [p.number, `phrase ${p.number}`]));
    },
    readSlackToken: () => null,
    readSlackChannel: () => null,
    slackUserOverride: () => null,
    lookupUserByEmail: async () => null,
    postMessage: async (...args) => {
      posted.push(args);
      return {};
    },
    now: () => new Date('2026-09-24T00:00:00Z'),
    out: (t) => out.push(t),
    err: (t) => err.push(t),
    ...over,
  };
  return { deps, out, err, posted, calls };
}

const OPTS: Opts = {
  to: 'production',
  parity: false,
  all: false,
  frontend: false,
  backend: false,
  byTicket: false,
  short: false,
  markdown: false,
  slack: false,
  json: true,
};

const report = (out: string[]) => JSON.parse(out[out.length - 1]);

test('PRs inside an open hotfix PR are in flight, the rest waiting', async () => {
  const f = fake();
  assert.equal(await runPending(['VastPayPwaV2'], OPTS, f.deps), 0);
  const fwd = report(f.out).repos[0].forward;
  assert.deepEqual(fwd.inFlight.map((g: { number: number }) => g.number), [334]);
  assert.deepEqual(fwd.inFlight[0].prs.map((p: { number: number }) => p.number), [301]);
  assert.deepEqual(fwd.waiting.map((p: { number: number }) => p.number), [313]);
  assert.equal(fwd.waiting[0].phrase, 'phrase 313');
});

test('--json prints nothing but the JSON', async () => {
  const f = fake();
  await runPending(['VastPayPwaV2'], OPTS, f.deps);
  assert.equal(f.out.length, 1);
  assert.doesNotThrow(() => JSON.parse(f.out[0]));
});

test('--to staging compares develop with staging and skips a repo with no develop', async () => {
  const branches: string[][] = [];
  const f = fake({ fetchBranches: async (_d, b) => (branches.push(b), true) });
  assert.equal(await runPending(['VastPayPwaV2', 'VastPay-BackEnd'], { ...OPTS, to: 'staging' }, f.deps), 0);
  const repos = report(f.out).repos;
  assert.equal(repos[0].forward.source, 'develop');
  assert.equal(repos[0].forward.target, 'staging');
  assert.deepEqual(repos[0].forward.inFlight, []);
  assert.deepEqual(repos[1].problem, { kind: 'skipped', message: 'no develop branch' });
  assert.deepEqual(branches, [['develop', 'staging']]);
});

test('a named repo that is not cloned fails the run; a swept one is skipped', async () => {
  const named = fake({ isCheckout: () => false });
  assert.equal(await runPending(['VastPayPwaV2'], OPTS, named.deps), 1);
  assert.equal(report(named.out).repos[0].problem.kind, 'error');

  const swept = fake({ isCheckout: () => false });
  assert.equal(await runPending([], { ...OPTS, frontend: true }, swept.deps), 0);
  for (const r of report(swept.out).repos) assert.equal(r.problem.kind, 'skipped');
});

test('--short makes no model call unless Slack needs the phrases', async () => {
  const short = fake();
  await runPending(['VastPayPwaV2'], { ...OPTS, short: true }, short.deps);
  assert.equal(short.calls.phrases, 0);

  const shortSlack = fake();
  await runPending(['VastPayPwaV2'], { ...OPTS, short: true, slack: true }, shortSlack.deps);
  assert.equal(shortSlack.calls.phrases, 1);
});

test('open release PRs that cannot be listed cost only the In flight section', async () => {
  const f = fake({
    openReleasePrs: async () => {
      throw new Error('gh down');
    },
  });
  assert.equal(await runPending(['VastPayPwaV2'], OPTS, f.deps), 0);
  const r = report(f.out).repos[0];
  assert.deepEqual(r.forward.inFlight, []);
  assert.deepEqual(r.forward.waiting.map((p: { number: number }) => p.number), [301, 313]);
  assert.equal(r.notes.length, 1);
});

test('a PR gh cannot read is still listed', async () => {
  const f = fake({ lookupPr: async (_r, n) => (n === 313 ? null : fake().deps.lookupPr('x', n)) });
  await runPending(['VastPayPwaV2'], OPTS, f.deps);
  const p313 = report(f.out).repos[0].forward.waiting[0];
  assert.equal(p313.detailsUnavailable, true);
  assert.equal(p313.title, 'fix/change-313');
});

test('--parity adds the reverse direction', async () => {
  const f = fake({ compareBranches: () => parityOf([313], [270]) });
  await runPending(['VastPayPwaV2'], { ...OPTS, parity: true }, f.deps);
  const r = report(f.out).repos[0];
  assert.equal(r.reverse.source, 'production');
  assert.equal(r.reverse.target, 'staging');
  assert.deepEqual(r.reverse.waiting.map((p: { number: number }) => p.number), [270]);
});

test('a failed fetch is an error for that repo only', async () => {
  const f = fake({ fetchBranches: async () => false });
  assert.equal(await runPending(['VastPayPwaV2'], OPTS, f.deps), 1);
  assert.deepEqual(report(f.out).repos[0].problem, { kind: 'error', message: 'fetch failed' });
});

test('--slack without configuration prints the message and fails', async () => {
  const f = fake();
  assert.equal(await runPending(['VastPayPwaV2'], { ...OPTS, json: false, slack: true }, f.deps), 1);
  assert.ok(f.out.some((l) => l.includes('Slack not configured — run vast slack setup')));
  assert.equal(f.posted.length, 0);
});

test('--slack posts text and blocks when configured', async () => {
  const f = fake({ readSlackToken: () => 'xoxb-test', readSlackChannel: () => 'C123' });
  assert.equal(await runPending(['VastPayPwaV2'], { ...OPTS, json: false, slack: true }, f.deps), 0);
  assert.equal(f.posted.length, 1);
  assert.equal(f.posted[0][1], 'C123');
  assert.match(String(f.posted[0][2]), /^\*Pending for production\*\n• </);
  assert.ok(Array.isArray(f.posted[0][3]));
});

test('a failed Slack post still prints the report and fails', async () => {
  const f = fake({
    readSlackToken: () => 'xoxb-test',
    readSlackChannel: () => 'C123',
    postMessage: async () => {
      throw new Error('channel_not_found');
    },
  });
  assert.equal(await runPending(['VastPayPwaV2'], { ...OPTS, json: false, slack: true }, f.deps), 1);
  assert.ok(f.out.some((l) => l.includes('Slack post failed: channel_not_found')));
});

test('nothing pending posts nothing and succeeds', async () => {
  const f = fake({
    compareBranches: () => parityOf([]),
    readSlackToken: () => 'xoxb-test',
    readSlackChannel: () => 'C123',
  });
  assert.equal(await runPending(['VastPayPwaV2'], { ...OPTS, json: false, slack: true }, f.deps), 0);
  assert.equal(f.posted.length, 0);
});

test('an unknown repository or a bad --to fails before any work', async () => {
  const f = fake();
  assert.equal(await runPending(['Nope'], OPTS, f.deps), 1);
  assert.equal(await runPending(['VastPayPwaV2'], { ...OPTS, to: 'qa' }, f.deps), 1);
  assert.equal(f.out.length, 0);
});

test('parseOpenReleasePrs keeps release and hotfix heads, by number', () => {
  const rows = parseOpenReleasePrs(
    JSON.stringify([
      { number: 340, headRefName: 'release/2.2.0', url: 'u340' },
      { number: 12, headRefName: 'feat/x', url: 'u12' },
      { number: 334, headRefName: 'hotfix/2.1.15', url: 'u334' },
    ]),
  );
  assert.deepEqual(rows, [
    { number: 334, url: 'u334', branch: 'hotfix/2.1.15' },
    { number: 340, url: 'u340', branch: 'release/2.2.0' },
  ]);
});
