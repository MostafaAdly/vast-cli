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

const details = (n: number) => ({
  title: `fix: change ${n}`,
  url: `https://github.com/Vast-menu/VastPayPwaV2/pull/${n}`,
  branch: `fix/change-${n}`,
  contributors: [{ name: 'Osama Elshimy', login: null, emails: ['o@e.com'] }],
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
  const calls = { phrases: 0, fetch: 0, contained: [] as Array<[string, string[]]> };
  const deps: Deps = {
    repoDir: () => '/checkout',
    isCheckout: () => true,
    fetchBranches: async () => (calls.fetch++, true),
    compareBranches: async () => parityOf([301, 313]),
    containedIn: async (_dir, ref, shas) => (calls.contained.push([ref, shas]), new Set()),
    prNumbersInRange: () => [301],
    lookupPrs: async (_repo, numbers) => new Map(numbers.map((n) => [n, details(n)])),
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
    terminalStyle: () => ({ paint: (_tone, text) => text, link: (text) => text }),
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
  assert.ok(f.err.includes('  VastPayPwaV2: could not list open release PRs — nothing shown as in flight'));
});

test('a PR gh cannot read is still listed', async () => {
  const f = fake({ lookupPrs: async (_r, numbers) => new Map(numbers.filter((n) => n !== 313).map((n) => [n, details(n)])) });
  await runPending(['VastPayPwaV2'], OPTS, f.deps);
  const p313 = report(f.out).repos[0].forward.waiting[0];
  assert.equal(p313.detailsUnavailable, true);
  assert.equal(p313.title, 'fix/change-313');
});

test('--parity adds the reverse direction', async () => {
  const f = fake({ compareBranches: async () => parityOf([313], [270]) });
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
    compareBranches: async () => parityOf([]),
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
  assert.deepEqual(f.err, ['Unknown repository: Nope', '--to must be production or staging, not "qa"']);
  assert.equal(f.calls.fetch, 0);
});

test('--dir with several repos, or names with a sweep flag, is refused as vast deploy refuses it', async () => {
  const f = fake();
  assert.equal(await runPending(['VastPayPwaV2', 'VastPayPwa'], { ...OPTS, dir: '/x' }, f.deps), 1);
  assert.equal(await runPending([], { ...OPTS, frontend: true, dir: '/x' }, f.deps), 1);
  assert.equal(await runPending(['VastPayPwaV2'], { ...OPTS, all: true }, f.deps), 1);
  assert.deepEqual(f.err, [
    '--dir names one checkout, so it cannot be used with a sweep flag or more than one repository.',
    '--dir names one checkout, so it cannot be used with a sweep flag or more than one repository.',
    'Pass repository names or a sweep flag (--all, --frontend, --backend), not both.',
  ]);
  assert.equal(f.out.length, 0);
  assert.equal(f.calls.fetch, 0);
});

test('a named repo with no staging → production flow is skipped, not failed', async () => {
  const f = fake();
  assert.equal(await runPending(['Terraform'], OPTS, f.deps), 0);
  assert.deepEqual(report(f.out).repos[0].problem, { kind: 'skipped', message: 'no staging → production flow' });
  assert.equal(f.calls.fetch, 0);
});

test('source and target must both fetch; a release head that will not fetch only leaves In flight', async () => {
  const fetches: string[][] = [];
  const f = fake({
    fetchBranches: async (_d, b) => (fetches.push(b), !b.includes('hotfix/2.1.15')),
  });
  assert.equal(await runPending(['VastPayPwaV2'], OPTS, f.deps), 0);
  assert.deepEqual(fetches, [['staging', 'production', 'hotfix/2.1.15'], ['staging', 'production'], ['hotfix/2.1.15']]);
  const r = report(f.out).repos[0];
  assert.deepEqual(r.forward.inFlight, []);
  assert.deepEqual(r.notes, ['could not fetch hotfix/2.1.15 (#334) — its PRs are not shown as in flight']);

  const broken = fake({ fetchBranches: async (_d, b) => b.length === 1 });
  assert.equal(await runPending(['VastPayPwaV2'], OPTS, broken.deps), 1);
  assert.deepEqual(report(broken.out).repos[0].problem, { kind: 'error', message: 'fetch failed' });
});

test('a direct commit an open hotfix branch carries is in flight', async () => {
  const parity = parityOf([313]);
  parity.onlySource.direct = [
    { sha: 'aaa571971c', subject: 'Update merchant files', landedAt: new Date('2026-09-01T00:00:00Z'), patchId: null },
    { sha: 'bbbfc83305', subject: 'Add build-deploy caller', landedAt: new Date('2026-09-17T00:00:00Z'), patchId: null },
  ];
  parity.onlySource.ported = new Set(['bbbfc83305']);
  const f = fake({
    compareBranches: async () => parity,
    containedIn: async (_d, ref, shas) => (f.calls.contained.push([ref, shas]), new Set(['aaa571971c'])),
  });
  assert.equal(await runPending(['VastPayPwaV2'], OPTS, f.deps), 0);
  // Only the commits production lacks are checked, against the head's branch.
  assert.deepEqual(f.calls.contained, [['origin/hotfix/2.1.15', ['aaa571971c']]]);
  const direct = report(f.out).repos[0].forward.direct;
  assert.deepEqual(direct[0].inFlight, { number: 334, branch: 'hotfix/2.1.15' });
  assert.equal(direct[1].inFlight, null);
});

// Observed live: "Pending", then "VastPayPwaV2", then "VastPayPwaV2 | staging
// → production". One repo's own line already names it and the direction.
test('one repo: the header does not repeat the repo line; a sweep header names the direction', async () => {
  const plainText = (t: string): string => t.replace(/\x1b\[[0-9;]*m/g, '');
  const one = fake();
  await runPending(['VastPayPwaV2'], { ...OPTS, json: false }, one.deps);
  assert.equal(plainText(one.out[0]).trim(), 'Pending');
  assert.equal(plainText(one.out.join('\n')).match(/VastPayPwaV2/g)?.length, 1);
  const sweep = fake();
  await runPending([], { ...OPTS, json: false, backend: true }, sweep.deps);
  assert.match(plainText(sweep.out[0]), /2 repo\(s\) \| staging → production/);
});

test('--json with --slack keeps stdout one JSON document and sends Slack lines to stderr', async () => {
  const f = fake();
  assert.equal(await runPending(['VastPayPwaV2'], { ...OPTS, slack: true }, f.deps), 1);
  assert.equal(f.out.length, 1);
  assert.doesNotThrow(() => JSON.parse(f.out[0]));
  assert.ok(f.err.includes('Slack not configured — run vast slack setup'));
  assert.ok(f.err.some((l) => l.startsWith('*Pending for production*')));
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

test('the terminal report is styled, the markdown never is', async () => {
  const f = fake({
    terminalStyle: () => ({ paint: (tone, text) => `<${tone}>${text}</${tone}>`, link: (text, url) => `[${text}](${url})` }),
  });
  await runPending(['VastPayPwaV2'], { ...OPTS, json: false, markdown: true }, f.deps);
  const all = f.out.join('\n');
  const [terminal, markdown] = all.split('──── markdown ────');
  assert.match(terminal, /\[<pr>#313<\/pr>\]\(https:\/\/github\.com\/Vast-menu\/VastPayPwaV2\/pull\/313\)/);
  assert.match(terminal, /\[<repo>VastPayPwaV2<\/repo>\]\(https:\/\/github\.com\/Vast-menu\/VastPayPwaV2\)/);
  assert.doesNotMatch(markdown, /<pr>|<repo>|<muted>/);
});

test('--json output carries the repo URL and no styling', async () => {
  const f = fake({
    terminalStyle: () => ({ paint: (tone, text) => `<${tone}>${text}</${tone}>`, link: (text) => text }),
  });
  await runPending(['VastPayPwaV2'], OPTS, f.deps);
  assert.equal(f.out.length, 1);
  assert.doesNotMatch(f.out[0], /<pr>/);
  assert.equal(JSON.parse(f.out[0]).repos[0].repoUrl, 'https://github.com/Vast-menu/VastPayPwaV2');
});
