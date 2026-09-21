import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildReleaseMessage,
  describe as describeChanges,
  extractTickets,
  type ShippedPr,
} from '../src/utils/release-message.js';

function pr(overrides: Partial<ShippedPr> = {}): ShippedPr {
  return {
    number: 412,
    title: 'feat(dashboard): per-card-type commission fixed addon',
    url: 'https://github.com/Vast-Group/VastMenuDashboard/pull/412',
    authorLogin: 'mostafa',
    authorName: 'Mostafa Adly',
    authorEmails: ['mostafa@vastgroup.co'],
    branch: 'feat/VA-12755-commission-addon',
    ...overrides,
  };
}

const RELEASE_PR = 'https://github.com/Vast-Group/VastMenuDashboard/pull/500';

test('extractTickets finds VA and CU ids, uppercased, in first-seen order', () => {
  assert.deepEqual(
    extractTickets(['fix VA-12755 and cu-8a9b2c', 'chore: VA-99 cleanup']),
    ['VA-12755', 'CU-8A9B2C', 'VA-99'],
  );
});

test('extractTickets keeps only the first sighting of a repeated ticket', () => {
  assert.deepEqual(
    extractTickets(['VA-12755 first', 'va-12755 again', 'VA-12756']),
    ['VA-12755', 'VA-12756'],
  );
});

test('extractTickets returns nothing when there is no ticket to find', () => {
  assert.deepEqual(extractTickets(['chore: tidy the readme', '']), []);
});

test('describe strips the conventional prefix and tidies each PR title', () => {
  const text = describeChanges(
    [
      pr({ title: 'feat(dashboard): per-card-type commission fixed addon' }),
      pr({ number: 413, title: 'fix: stale totals on the orders tab.' }),
    ],
    [],
  );
  assert.equal(text, 'Per-card-type commission fixed addon, Stale totals on the orders tab');
});

test('describe says a repeated change once', () => {
  const text = describeChanges(
    [
      pr({ title: 'feat(dashboard): per-card-type commission fixed addon' }),
      pr({ number: 413, title: 'Per-card-type commission fixed addon' }),
    ],
    [],
  );
  assert.equal(text, 'Per-card-type commission fixed addon');
});

test('describe falls back to the commit subjects when there are no PRs', () => {
  assert.equal(describeChanges([], ['bumped the timeout', 'fixed the totals']), 'Bumped the timeout, Fixed the totals');
});

test('describe stops at six items and marks the tail', () => {
  const subjects = ['one', 'two', 'three', 'four', 'five', 'six', 'seven'];
  assert.equal(describeChanges([], subjects), 'One, Two, Three, Four, Five, Six, …');
});

test('buildReleaseMessage renders the release line exactly as the team reads it', () => {
  const message = buildReleaseMessage({
    displayName: 'Vastmenu Dashboard',
    branch: 'release/2.1.25',
    prUrl: RELEASE_PR,
    prs: [
      pr(),
      pr({
        number: 413,
        title: 'Per-card-type commission fixed addon',
        authorLogin: 'mkassem',
        authorName: 'Mahmoud Kassem',
        authorEmails: [],
      }),
    ],
    fallbackSubjects: [],
    mentions: { mostafa: 'U123', mkassem: null },
  });

  assert.equal(
    message,
    `• <${RELEASE_PR}|Vastmenu Dashboard - release/2.1.25> - Per-card-type commission fixed addon ` +
      '(<@U123>, @Mahmoud Kassem) (<https://app.clickup.com/t/90121402342/VA-12755|VA-12755>)',
  );
});

test('buildReleaseMessage omits the authors group when there are none', () => {
  const message = buildReleaseMessage({
    displayName: 'Vastmenu Dashboard',
    branch: 'release/2.1.25',
    prUrl: RELEASE_PR,
    prs: [],
    fallbackSubjects: ['fix: stale totals VA-12755'],
    mentions: {},
  });

  assert.equal(
    message,
    `• <${RELEASE_PR}|Vastmenu Dashboard - release/2.1.25> - Fix: stale totals VA-12755 ` +
      '(<https://app.clickup.com/t/90121402342/VA-12755|VA-12755>)',
  );
});

test('buildReleaseMessage omits the ticket group when nothing references a ticket', () => {
  const message = buildReleaseMessage({
    displayName: 'Vastmenu Dashboard',
    branch: 'release/2.1.25',
    prUrl: RELEASE_PR,
    prs: [pr({ title: 'fix: stale totals', branch: 'fix/totals' })],
    fallbackSubjects: [],
    mentions: { mostafa: 'U123' },
  });

  assert.equal(
    message,
    `• <${RELEASE_PR}|Vastmenu Dashboard - release/2.1.25> - Stale totals (<@U123>)`,
  );
});

test('buildReleaseMessage names an unmatched author by their GitHub login when no name is set', () => {
  const message = buildReleaseMessage({
    displayName: 'Vastmenu Dashboard',
    branch: 'release/2.1.25',
    prUrl: RELEASE_PR,
    prs: [pr({ title: 'fix: stale totals', branch: 'fix/totals', authorName: '' })],
    fallbackSubjects: [],
    mentions: { mostafa: null },
  });

  assert.equal(
    message,
    `• <${RELEASE_PR}|Vastmenu Dashboard - release/2.1.25> - Stale totals (@mostafa)`,
  );
});

test('buildReleaseMessage names each author once, in the order they appear', () => {
  const message = buildReleaseMessage({
    displayName: 'Vastmenu Dashboard',
    branch: 'release/2.1.25',
    prUrl: RELEASE_PR,
    prs: [
      pr({ title: 'fix: a', branch: 'fix/a' }),
      pr({ number: 2, title: 'fix: b', branch: 'fix/b', authorLogin: 'mkassem', authorName: 'Mahmoud Kassem' }),
      pr({ number: 3, title: 'fix: c', branch: 'fix/c' }),
    ],
    fallbackSubjects: [],
    mentions: { mostafa: 'U123', mkassem: 'U456' },
  });

  assert.equal(
    message,
    `• <${RELEASE_PR}|Vastmenu Dashboard - release/2.1.25> - A, B, C (<@U123>, <@U456>)`,
  );
});

test('buildReleaseMessage escapes the characters Slack reads as markup', () => {
  const message = buildReleaseMessage({
    displayName: 'Vast <Menu> & Co',
    branch: 'release/2.1.25',
    prUrl: RELEASE_PR,
    prs: [
      pr({
        title: 'fix: totals < 0 & > 100 break the card',
        branch: 'fix/totals',
        authorName: 'Ali & Co',
      }),
    ],
    fallbackSubjects: [],
    mentions: { mostafa: null },
  });

  assert.equal(
    message,
    `• <${RELEASE_PR}|Vast &lt;Menu&gt; &amp; Co - release/2.1.25> - ` +
      'Totals &lt; 0 &amp; &gt; 100 break the card (@Ali &amp; Co)',
  );
});

test('buildReleaseMessage reads tickets out of branch names too', () => {
  const message = buildReleaseMessage({
    displayName: 'Vastmenu Dashboard',
    branch: 'release/2.1.25',
    prUrl: RELEASE_PR,
    prs: [pr({ title: 'fix: stale totals', branch: 'fix/VA-777-totals' })],
    fallbackSubjects: [],
    mentions: { mostafa: 'U123' },
  });

  assert.equal(
    message,
    `• <${RELEASE_PR}|Vastmenu Dashboard - release/2.1.25> - Stale totals (<@U123>) ` +
      '(<https://app.clickup.com/t/90121402342/VA-777|VA-777>)',
  );
});

test('buildReleaseMessage lists several tickets comma-separated', () => {
  const message = buildReleaseMessage({
    displayName: 'Vastmenu Dashboard',
    branch: 'release/2.1.25',
    prUrl: RELEASE_PR,
    prs: [
      pr({ title: 'fix: stale totals VA-777', branch: 'fix/totals' }),
      pr({ number: 2, title: 'fix: card VA-778', branch: 'fix/card' }),
    ],
    fallbackSubjects: [],
    mentions: { mostafa: 'U123' },
  });

  assert.equal(
    message,
    `• <${RELEASE_PR}|Vastmenu Dashboard - release/2.1.25> - Stale totals VA-777, Card VA-778 (<@U123>) ` +
      '(<https://app.clickup.com/t/90121402342/VA-777|VA-777>, ' +
      '<https://app.clickup.com/t/90121402342/VA-778|VA-778>)',
  );
});
