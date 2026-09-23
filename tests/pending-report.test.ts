import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDirection, renderTerminal, type RepoPending } from '../src/utils/pending-report.js';
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
    openReleases: [{ number: 334, url: `${REPO_URL}/pull/334`, branch: 'hotfix/2.1.15', prNumbers: [301] }],
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
