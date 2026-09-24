import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDirection, renderJson, renderMarkdown, renderTerminal, type RepoPending } from '../src/utils/pending-report.js';
import { NOW, daysAgo, REPO_URL, OSAMA, MOSTAFA, pr, fixtureRepo, fixtureReport } from './pending-fixtures.js';

const OPTS = { now: NOW, byTicket: false, short: false };

test('buildDirection turns a comparison into PRs, moving those in an open release PR to In flight', () => {
  const d = buildDirection({
    source: 'staging',
    target: 'production',
    side: {
      prs: [
        { number: 313, branch: 'Osama/VA-13091', sha: 's313', landedAt: daysAgo(9), patchId: null },
        { number: 301, branch: 'fix/elm', sha: 's301', landedAt: daysAgo(13), patchId: 'p' },
        { number: 400, branch: 'fix/unknown', sha: 's400', landedAt: daysAgo(1), patchId: null },
      ],
      direct: [{ sha: 'd1', subject: 'fix: direct', landedAt: daysAgo(2), patchId: null }],
      ported: new Set(['s301']),
    },
    details: new Map([
      [301, { title: 'fix(elm): one create-charge per sheet', url: `${REPO_URL}/pull/301`, branch: 'fix/elm', contributors: [MOSTAFA] }],
      [313, { title: 'fix: reuse guest tokens', url: `${REPO_URL}/pull/313`, branch: 'Osama/VA-13091', contributors: [OSAMA] }],
    ]),
    phrases: { 313: 'guest token reuse' },
    openReleases: [{ number: 334, url: `${REPO_URL}/pull/334`, branch: 'hotfix/2.1.15', prNumbers: [301], commits: [] }],
    repoUrl: REPO_URL,
  });

  assert.deepEqual(d.inFlight.map((g) => [g.number, g.prs.map((p) => p.number)]), [[334, [301]]]);
  assert.deepEqual(d.waiting.map((p) => p.number), [313, 400]);
  const [p313, p400] = d.waiting;
  assert.equal(p313.title, 'Reuse guest tokens');
  assert.equal(p313.phrase, 'guest token reuse');
  assert.deepEqual(p313.tickets, ['VA-13091']);
  assert.equal(d.inFlight[0].prs[0].ported, true);
  assert.equal(d.inFlight[0].prs[0].title, 'One create-charge per sheet');
  assert.equal(p400.detailsUnavailable, true);
  assert.equal(p400.title, 'fix/unknown');
  assert.equal(p400.url, `${REPO_URL}/pull/400`);
  assert.deepEqual(d.direct.map((c) => c.subject), ['fix: direct']);
});

test('a PR inside two open release PRs is claimed by the newest; groups stay in number order', () => {
  const d = buildDirection({
    source: 'staging',
    target: 'production',
    side: {
      prs: [
        { number: 298, branch: 'fix/sentry', sha: 's298', landedAt: daysAgo(22), patchId: null },
        { number: 301, branch: 'fix/elm', sha: 's301', landedAt: daysAgo(21), patchId: null },
      ],
      direct: [],
      ported: new Set(),
    },
    details: new Map(),
    phrases: {},
    openReleases: [
      { number: 302, url: `${REPO_URL}/pull/302`, branch: 'hotfix/2.1.11', prNumbers: [298], commits: [] },
      { number: 334, url: `${REPO_URL}/pull/334`, branch: 'hotfix/2.1.15', prNumbers: [301], commits: [] },
      { number: 305, url: `${REPO_URL}/pull/305`, branch: 'hotfix/2.1.13', prNumbers: [301], commits: [] },
    ],
    repoUrl: REPO_URL,
  });
  assert.deepEqual(d.inFlight.map((g) => [g.number, g.prs.map((p) => p.number)]), [[302, [298]], [334, [301]]]);
});

test('a direct commit carried by an open release branch is in flight, newest release first', () => {
  const d = buildDirection({
    source: 'staging',
    target: 'production',
    side: {
      prs: [],
      direct: [
        { sha: 'c571971', subject: 'Update merchant files', landedAt: daysAgo(23), patchId: null },
        { sha: 'c1204bc', subject: 'chore(env): pusher key', landedAt: daysAgo(7), patchId: null },
      ],
      ported: new Set(),
    },
    details: new Map(),
    phrases: {},
    openReleases: [
      { number: 303, url: `${REPO_URL}/pull/303`, branch: 'hotfix/2.1.12', prNumbers: [], commits: ['c571971'] },
      { number: 305, url: `${REPO_URL}/pull/305`, branch: 'hotfix/2.1.13', prNumbers: [], commits: ['c571971'] },
    ],
    repoUrl: REPO_URL,
  });
  assert.deepEqual(
    d.direct.map((c) => [c.sha, c.inFlight]),
    [
      ['c571971', { number: 305, branch: 'hotfix/2.1.13' }],
      ['c1204bc', null],
    ],
  );
});

test('an in-flight direct commit shows where it is instead of stale, in every renderer', () => {
  const repo = fixtureRepo();
  repo.forward!.direct = [
    { sha: '571971c' + 'b'.repeat(33), subject: 'Update merchant files', landedAt: daysAgo(23), ported: false, inFlight: { number: 303, branch: 'hotfix/2.1.12' } },
  ];
  const term = renderTerminal(fixtureReport([repo], false), OPTS);
  assert.match(term, /^ {4}571971c {2}Update merchant files · 23d {2}in flight · hotfix\/2\.1\.12 \(#303\)$/m);
  assert.doesNotMatch(term, /571971c[^\n]*stale/);
  const md = renderMarkdown(fixtureReport([repo], false), OPTS);
  assert.match(md, /^- `571971c` Update merchant files · 23d · in flight · hotfix\/2\.1\.12 \(#303\)$/m);
  const json = JSON.parse(renderJson(fixtureReport([repo], false)));
  assert.deepEqual(json.repos[0].forward.direct[0].inFlight, { number: 303, branch: 'hotfix/2.1.12' });
  // In a sweep it counts as in flight, not waiting.
  const table = renderTerminal(fixtureReport([repo, fixtureRepo()], false), OPTS).split('\n\n')[0].split('\n');
  assert.match(table[1], /^ {2}VastPayPwaV2 +2 +2 +23d$/);
});

// A PR already in an open release PR is on its way: its age is no longer the
// question, as for an in-flight direct commit.
test('a PR under In flight is never marked stale, in every renderer', () => {
  const repo = fixtureRepo();
  repo.forward!.inFlight[0].prs = [pr(301, { title: 'One create-charge per sheet', landedAt: daysAgo(30) })];
  const term = renderTerminal(fixtureReport([repo], false), OPTS);
  assert.match(term, /^ {10}Osama Elshimy · 30d$/m);
  const md = renderMarkdown(fixtureReport([repo], false), OPTS);
  assert.match(md, /^- \[#301\]\([^)]+\) One create-charge per sheet · Osama Elshimy · 30d$/m);
  // A waiting PR of the same age still is.
  assert.match(term, /Osama Elshimy · 21d {2}⚠ stale/);
});

test('markdown escapes what a title, phrase or subject could otherwise turn into formatting', () => {
  const repo = fixtureRepo();
  repo.forward!.inFlight = [];
  repo.forward!.waiting = [pr(340, { title: 'Fix <PaymentSheet> *overlap*', phrase: 'sheet_overlap', landedAt: daysAgo(1) })];
  repo.forward!.direct = [
    { sha: 'abcdef1' + 'c'.repeat(33), subject: 'chore: `pnpm` [skip] \\ path_x', landedAt: daysAgo(1), ported: false, inFlight: null },
  ];
  const md = renderMarkdown(fixtureReport([repo], false), OPTS);
  assert.match(md, /^- \[#340\]\(https:\/\/github\.com\/Vast-menu\/VastPayPwaV2\/pull\/340\) \*\*sheet\\_overlap\*\* — Fix \\<PaymentSheet\\> \\\*overlap\\\* · /m);
  assert.ok(md.includes('- `abcdef1` chore: \\`pnpm\\` \\[skip\\] \\\\ path\\_x · 1d'), md);
});

test('terminal: one repo with both directions', () => {
  assert.equal(
    renderTerminal(fixtureReport(), OPTS),
    [
      '  VastPayPwaV2 | staging → production',
      '',
      '  In flight · hotfix/2.1.15 (#334, open)',
      '    #301  ELM single charge — One create-charge per sheet',
      '          Mostafa Adly · 13d',
      '',
      '  Waiting (2)',
      '    #298  Old change',
      '          Osama Elshimy · 21d  ⚠ stale',
      '    #313  guest token reuse — Reuse guest tokens without overriding customer sessions',
      '          Osama Elshimy · VA-13091 · 9d',
      '',
      '  Direct commits (1)',
      '    46d26d9  fix(pwa): preserve disabled plugin lifecycle · 3d',
      '',
      '  3 PRs · 1 direct commit · 1 ticket · oldest 21 days',
      '',
      '  On production, not on staging (2)',
      '    #270  Include guest token in send-OTP request',
      '          Osama Elshimy · 30d  ported (same code)',
      '    #332  Raise pwa-v2 memory request',
      '          Osama Elshimy · 5d  ⚠ not found on staging',
    ].join('\n'),
  );
});

test('terminal --short shows titles only', () => {
  const out = renderTerminal(fixtureReport(), { ...OPTS, short: true });
  assert.match(out, /^ {4}#313 {2}Reuse guest tokens without overriding customer sessions$/m);
  assert.doesNotMatch(out, /guest token reuse/);
});

test('terminal --by-ticket groups PRs under their tickets, untracked last', () => {
  const out = renderTerminal(fixtureReport(), { ...OPTS, byTicket: true });
  assert.match(
    out,
    /  Waiting \(2\)\n {4}VA-13091\n {6}#313 {2}guest token reuse — [^\n]+\n[^\n]+\n {4}Untracked\n {6}#298 {2}Old change/,
  );
});

test('terminal: a repo with nothing either way collapses to in sync', () => {
  const repo = fixtureRepo();
  repo.forward = { ...repo.forward!, inFlight: [], waiting: [], direct: [] };
  repo.reverse = { ...repo.reverse!, waiting: [] };
  assert.equal(renderTerminal(fixtureReport([repo]), OPTS), '  VastPayPwaV2 | staging → production · in sync');
});

test('terminal: nothing forward but something back says so', () => {
  const repo = fixtureRepo();
  repo.forward = { ...repo.forward!, inFlight: [], waiting: [], direct: [] };
  const out = renderTerminal(fixtureReport([repo]), OPTS);
  assert.match(out, /  Nothing on staging that production lacks\./);
  assert.match(out, /  On production, not on staging \(2\)/);
});

test('terminal: a repo with a problem is one line', () => {
  const repo: RepoPending = {
    ...fixtureRepo(),
    repo: 'VastPay-BackEnd',
    forward: null,
    reverse: null,
    problem: { kind: 'skipped', message: 'no develop branch' },
  };
  assert.equal(renderTerminal(fixtureReport([repo]), OPTS), '  VastPay-BackEnd  no develop branch');
});

test('terminal: a PR gh could not read is flagged', () => {
  const repo = fixtureRepo();
  repo.forward!.waiting = [pr(400, { title: 'fix/unknown', contributors: [], detailsUnavailable: true, landedAt: daysAgo(1) })];
  assert.match(renderTerminal(fixtureReport([repo], false), OPTS), /#400 {2}fix\/unknown\n {10}1d {2}details unavailable/);
});

test('terminal: a sweep opens with a summary table', () => {
  const skipped: RepoPending = {
    ...fixtureRepo(),
    repo: 'VastPay-BackEnd',
    forward: null,
    reverse: null,
    problem: { kind: 'skipped', message: 'no develop branch' },
  };
  const out = renderTerminal(fixtureReport([fixtureRepo(), skipped]), OPTS);
  const table = out.split('\n\n')[0].split('\n');
  assert.match(table[0], /^ {2}REPO +WAITING +IN FLIGHT +PRODUCTION ONLY +OLDEST$/);
  assert.match(table[1], /^ {2}VastPayPwaV2 +3 +1 +2 +21d$/);
  assert.match(table[2], /^ {2}VastPay-BackEnd +no develop branch$/);
});

test('markdown: one repo with both directions', () => {
  const pull = (n: number): string => `${REPO_URL}/pull/${n}`;
  assert.equal(
    renderMarkdown(fixtureReport(), OPTS),
    [
      '## Vastpay Pwa V2 — staging → production',
      '',
      `### In flight · [hotfix/2.1.15 (#334)](${pull(334)})`,
      '',
      `- [#301](${pull(301)}) **ELM single charge** — One create-charge per sheet · Mostafa Adly · 13d`,
      '',
      '### Waiting (2)',
      '',
      `- [#298](${pull(298)}) Old change · Osama Elshimy · 21d · ⚠ stale`,
      `- [#313](${pull(313)}) **guest token reuse** — Reuse guest tokens without overriding customer sessions · Osama Elshimy · [VA-13091](https://app.clickup.com/t/90121402342/VA-13091) · 9d`,
      '',
      '### Direct commits (1)',
      '',
      '- `46d26d9` fix(pwa): preserve disabled plugin lifecycle · 3d',
      '',
      '### On production, not on staging (2)',
      '',
      `- [#270](${pull(270)}) Include guest token in send-OTP request · Osama Elshimy · 30d · ported (same code)`,
      `- [#332](${pull(332)}) Raise pwa-v2 memory request · Osama Elshimy · 5d · ⚠ not found on staging`,
      '',
    ].join('\n'),
  );
});

test('markdown: in sync and problem repos are one line each', () => {
  const synced = fixtureRepo();
  synced.forward = { ...synced.forward!, inFlight: [], waiting: [], direct: [] };
  synced.reverse = null;
  const skipped: RepoPending = {
    ...fixtureRepo(),
    displayName: 'Vastpay Backend',
    forward: null,
    reverse: null,
    problem: { kind: 'skipped', message: 'no develop branch' },
  };
  assert.equal(
    renderMarkdown(fixtureReport([synced, skipped], false), OPTS),
    '## Vastpay Pwa V2 — staging → production\n\nIn sync.\n\n## Vastpay Backend\n\n_no develop branch_\n',
  );
});

test('markdown --by-ticket nests PRs under linked tickets', () => {
  const out = renderMarkdown(fixtureReport(), { ...OPTS, byTicket: true });
  assert.match(out, /- \*\*\[VA-13091\]\(https:\/\/app\.clickup\.com\/t\/90121402342\/VA-13091\)\*\*\n {2}- \[#313\]/);
  assert.match(out, /- \*\*Untracked\*\*\n {2}- \[#298\]/);
});

test('json round-trips the model with ISO dates', () => {
  const parsed = JSON.parse(renderJson(fixtureReport()));
  assert.equal(parsed.to, 'production');
  assert.equal(parsed.generatedAt, NOW.toISOString());
  assert.equal(parsed.repos[0].forward.waiting[1].number, 313);
  assert.equal(parsed.repos[0].forward.waiting[1].landedAt, daysAgo(9).toISOString());
});
