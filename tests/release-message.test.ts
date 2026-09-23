import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildReleaseMessage,
  describe as describeChanges,
  extractTickets,
  releaseContributors,
  type ReleaseMessageInput,
} from '../src/utils/release-message.js';
import type { ShippedPr } from '../src/utils/shipped.js';
import { contributorKey, type Contributor } from '../src/utils/contributors.js';

const RELEASE_PR = 'https://github.com/Vast-Group/VastPayPwaV2/pull/900';
const clickup = (id: string): string => `https://app.clickup.com/t/90121402342/${id}`;

const MOSTAFA: Contributor = { name: 'Mostafa Adly', login: 'MostafaAdly', emails: ['mostafa@example.com'] };
const OSAMA: Contributor = { name: 'Osama Elshimy', login: 'osama-elshimy', emails: ['osama@example.com'] };

function pr(number: number, overrides: Partial<ShippedPr> = {}): ShippedPr {
  return {
    number,
    title: `fix: change ${number}`,
    url: `https://github.com/Vast-Group/VastPayPwaV2/pull/${number}`,
    branch: `fix/change-${number}`,
    contributors: [MOSTAFA],
    ...overrides,
  };
}

function input(overrides: Partial<ReleaseMessageInput> = {}): ReleaseMessageInput {
  return {
    displayName: 'Vastpay Pwa V2',
    branch: 'hotfix/2.1.15',
    prUrl: RELEASE_PR,
    prs: [],
    summaries: {},
    fallbackSubjects: [],
    mentions: {},
    ...overrides,
  };
}

/** Pull the section elements out of the one bullet, asserting the wrapper on the way. */
function sectionOf(blocks: unknown[]): unknown[] {
  assert.equal(blocks.length, 1);
  const block = blocks[0] as { type: string; elements: unknown[] };
  assert.equal(block.type, 'rich_text');
  assert.equal(block.elements.length, 1);
  const list = block.elements[0] as { type: string; style: string; elements: unknown[] };
  assert.equal(list.type, 'rich_text_list');
  assert.equal(list.style, 'bullet');
  assert.equal(list.elements.length, 1);
  const section = list.elements[0] as { type: string; elements: unknown[] };
  assert.equal(section.type, 'rich_text_section');
  return section.elements;
}

// ---- extractTickets ----------------------------------------------------------

test('extractTickets finds VA and CU ids, uppercased, in first-seen order', () => {
  assert.deepEqual(
    extractTickets(['fix VA-12755 and cu-8a9b2c', 'chore: VA-99 cleanup']),
    ['VA-12755', 'CU-8A9B2C', 'VA-99'],
  );
});

test('extractTickets keeps only the first sighting of a repeated ticket', () => {
  assert.deepEqual(extractTickets(['VA-12755 first', 'va-12755 again', 'VA-12756']), ['VA-12755', 'VA-12756']);
});

test('extractTickets returns nothing when there is no ticket to find', () => {
  assert.deepEqual(extractTickets(['chore: tidy the readme', '']), []);
});

// ---- describe ----------------------------------------------------------------

test('describe lists the summaries in ascending PR order, whatever order the PRs arrive in', () => {
  const text = describeChanges(
    [pr(803), pr(801), pr(802)],
    { 801: 'ELM single charge', 802: 'apple Pay layout', 803: 'guest token reuse' },
    [],
  );
  assert.equal(text, 'ELM single charge, apple Pay layout, guest token reuse');
});

test('describe capitalises only the first letter of the whole line', () => {
  const text = describeChanges([pr(1), pr(2)], { 1: 'stale order recovery', 2: 'order dialog UI' }, []);
  assert.equal(text, 'Stale order recovery, order dialog UI');
});

test('describe falls back to the tidied PR title when a PR has no summary', () => {
  const text = describeChanges(
    [pr(1, { title: 'feat(dashboard): per-card-type commission fixed addon.' }), pr(2)],
    { 2: 'order dialog UI' },
    [],
  );
  assert.equal(text, 'Per-card-type commission fixed addon, order dialog UI');
});

test('describe says a repeated change once', () => {
  const text = describeChanges([pr(1), pr(2)], { 1: 'guest token reuse', 2: 'guest token reuse' }, []);
  assert.equal(text, 'Guest token reuse');
});

test('describe ignores the commit subjects whenever there are PRs', () => {
  assert.equal(describeChanges([pr(1)], { 1: 'guest token reuse' }, ['something else']), 'Guest token reuse');
});

test('describe falls back to the commit subjects when there are no PRs', () => {
  assert.equal(describeChanges([], {}, ['bumped the timeout', 'fixed the totals']), 'Bumped the timeout, Fixed the totals');
});

// Merge commits and CI version bumps describe the pipeline, not the product.
test('describe leaves merge and version-bump subjects out of the fallback', () => {
  const text = describeChanges(
    [],
    {},
    [
      'Merge pull request #7 from Vast-Menu/feat/x',
      "Merge branch 'staging' into production",
      "Merge remote-tracking branch 'origin/staging'",
      'chore: bump version to 2.1.15',
      'chore: align package.json version with production',
      'fixed the totals',
    ],
  );
  assert.equal(text, 'Fixed the totals');
});

test('describe stops the fallback at six items and marks the tail', () => {
  const subjects = ['one', 'two', 'three', 'four', 'five', 'six', 'seven'];
  assert.equal(describeChanges([], {}, subjects), 'One, Two, Three, Four, Five, Six, …');
});

// ---- releaseContributors -----------------------------------------------------

test('releaseContributors names each person once, in ascending PR order', () => {
  const people = releaseContributors([
    pr(2, { contributors: [OSAMA, MOSTAFA] }),
    pr(1, { contributors: [MOSTAFA] }),
  ]);
  assert.deepEqual(
    people.map((p) => p.name),
    ['Mostafa Adly', 'Osama Elshimy'],
  );
});

test('releaseContributors leaves out the excluded people and bots', () => {
  const people = releaseContributors([
    pr(1, {
      contributors: [
        MOSTAFA,
        { name: 'Mahmoud Elzahaby', login: null, emails: [] },
        { name: 'Ali Elhabal', login: null, emails: [] },
        { name: 'Youssif Elzahaby', login: null, emails: [] },
        { name: '', login: 'github-actions[bot]', emails: [] },
      ],
    }),
  ]);
  assert.deepEqual(people.map((p) => p.name), ['Mostafa Adly']);
});

// ---- buildReleaseMessage: the user's own hand-written post -----------------------

/**
 * The post the team already writes by hand, reproduced PR for PR: seven fixes
 * in one hotfix, two people, three tickets. PRs arrive shuffled to prove the
 * order comes from the PR numbers.
 */
function targetInput(): ReleaseMessageInput {
  return input({
    prs: [
      pr(806, { branch: 'fix/VA-13121-elm-3ds', contributors: [OSAMA] }),
      pr(801, { branch: 'fix/VA-13091-elm-single-charge' }),
      pr(802, { branch: 'fix/apple-pay-layout' }),
      pr(803, { branch: 'fix/guest-token', title: 'fix: reuse the guest token VA-13085', contributors: [OSAMA, MOSTAFA] }),
      pr(805, { branch: 'fix/VA-13121-elm-3ds-confirmation' }),
      pr(804, { branch: 'fix/stale-orders' }),
      pr(807, { branch: 'fix/cancelled-orders' }),
    ],
    summaries: {
      801: 'ELM single charge',
      802: 'Apple Pay layout',
      803: 'guest token reuse',
      804: 'ELM 3DS confirmation',
      805: 'stale order recovery',
      806: 'order dialog UI',
      807: 'cancelled order detection',
    },
    mentions: { [contributorKey(MOSTAFA)]: 'U1', [contributorKey(OSAMA)]: null },
  });
}

test('buildReleaseMessage text matches the hand-written post', () => {
  const { text } = buildReleaseMessage(targetInput());
  assert.equal(
    text,
    `• <${RELEASE_PR}|Vastpay Pwa V2 - hotfix/2.1.15> - ELM single charge, Apple Pay layout, guest token reuse, ` +
      'ELM 3DS confirmation, stale order recovery, order dialog UI, cancelled order detection ' +
      '(<@U1>, @Osama Elshimy) ' +
      `(<${clickup('VA-13091')}|VA-13091>, <${clickup('VA-13085')}|VA-13085>, <${clickup('VA-13121')}|VA-13121>)`,
  );
});

test('buildReleaseMessage blocks are one real Slack bullet with mentions and ticket links', () => {
  const { blocks } = buildReleaseMessage(targetInput());
  assert.deepEqual(blocks, [
    {
      type: 'rich_text',
      elements: [
        {
          type: 'rich_text_list',
          style: 'bullet',
          elements: [
            {
              type: 'rich_text_section',
              elements: [
                { type: 'link', url: RELEASE_PR, text: 'Vastpay Pwa V2 - hotfix/2.1.15' },
                {
                  type: 'text',
                  text:
                    ' - ELM single charge, Apple Pay layout, guest token reuse, ELM 3DS confirmation, ' +
                    'stale order recovery, order dialog UI, cancelled order detection (',
                },
                { type: 'user', user_id: 'U1' },
                { type: 'text', text: ', ' },
                { type: 'text', text: '@Osama Elshimy' },
                { type: 'text', text: ') (' },
                { type: 'link', url: clickup('VA-13091'), text: 'VA-13091' },
                { type: 'text', text: ', ' },
                { type: 'link', url: clickup('VA-13085'), text: 'VA-13085' },
                { type: 'text', text: ', ' },
                { type: 'link', url: clickup('VA-13121'), text: 'VA-13121' },
                { type: 'text', text: ')' },
              ],
            },
          ],
        },
      ],
    },
  ]);
});

test('buildReleaseMessage mentions two resolved people as two user elements', () => {
  const { text, blocks } = buildReleaseMessage(
    input({
      prs: [pr(1, { contributors: [MOSTAFA, OSAMA], branch: 'fix/x' })],
      summaries: { 1: 'guest token reuse' },
      mentions: { [contributorKey(MOSTAFA)]: 'U1', [contributorKey(OSAMA)]: 'U2' },
    }),
  );
  assert.equal(text, `• <${RELEASE_PR}|Vastpay Pwa V2 - hotfix/2.1.15> - Guest token reuse (<@U1>, <@U2>)`);
  assert.deepEqual(sectionOf(blocks).slice(2), [
    { type: 'user', user_id: 'U1' },
    { type: 'text', text: ', ' },
    { type: 'user', user_id: 'U2' },
    { type: 'text', text: ')' },
  ]);
});

// ---- buildReleaseMessage: edge cases ----------------------------------------------

test('buildReleaseMessage omits the people group when nobody is named', () => {
  const { text, blocks } = buildReleaseMessage(
    input({ fallbackSubjects: ['fix: stale totals VA-12755'] }),
  );
  assert.equal(
    text,
    `• <${RELEASE_PR}|Vastpay Pwa V2 - hotfix/2.1.15> - Fix: stale totals VA-12755 ` +
      `(<${clickup('VA-12755')}|VA-12755>)`,
  );
  assert.deepEqual(sectionOf(blocks), [
    { type: 'link', url: RELEASE_PR, text: 'Vastpay Pwa V2 - hotfix/2.1.15' },
    { type: 'text', text: ' - Fix: stale totals VA-12755' },
    { type: 'text', text: ' (' },
    { type: 'link', url: clickup('VA-12755'), text: 'VA-12755' },
    { type: 'text', text: ')' },
  ]);
});

test('buildReleaseMessage omits the ticket group when nothing references a ticket', () => {
  const { text, blocks } = buildReleaseMessage(
    input({
      prs: [pr(1, { branch: 'fix/totals' })],
      summaries: { 1: 'stale totals' },
      mentions: { [contributorKey(MOSTAFA)]: 'U1' },
    }),
  );
  assert.equal(text, `• <${RELEASE_PR}|Vastpay Pwa V2 - hotfix/2.1.15> - Stale totals (<@U1>)`);
  assert.deepEqual(sectionOf(blocks), [
    { type: 'link', url: RELEASE_PR, text: 'Vastpay Pwa V2 - hotfix/2.1.15' },
    { type: 'text', text: ' - Stale totals (' },
    { type: 'user', user_id: 'U1' },
    { type: 'text', text: ')' },
  ]);
});

test('buildReleaseMessage is just the link and the description when there are no people and no tickets', () => {
  const { text, blocks } = buildReleaseMessage(input({ fallbackSubjects: ['fixed the totals'] }));
  assert.equal(text, `• <${RELEASE_PR}|Vastpay Pwa V2 - hotfix/2.1.15> - Fixed the totals`);
  assert.deepEqual(sectionOf(blocks), [
    { type: 'link', url: RELEASE_PR, text: 'Vastpay Pwa V2 - hotfix/2.1.15' },
    { type: 'text', text: ' - Fixed the totals' },
  ]);
});

test('buildReleaseMessage names an unmatched person by login when they have no name', () => {
  const nameless: Contributor = { name: '', login: 'osama-elshimy', emails: [] };
  const { text } = buildReleaseMessage(
    input({ prs: [pr(1, { branch: 'fix/x', contributors: [nameless] })], summaries: { 1: 'stale totals' } }),
  );
  assert.equal(text, `• <${RELEASE_PR}|Vastpay Pwa V2 - hotfix/2.1.15> - Stale totals (@osama-elshimy)`);
});

test('buildReleaseMessage reads tickets from titles and branches in ascending PR order, then subjects', () => {
  const { text } = buildReleaseMessage(
    input({
      prs: [
        pr(2, { branch: 'fix/VA-2-b', title: 'fix: b' }),
        pr(1, { branch: 'fix/a', title: 'fix: a VA-1' }),
      ],
      summaries: { 1: 'a', 2: 'b' },
      fallbackSubjects: ['fix: c VA-3', 'fix: a again VA-1'],
    }),
  );
  assert.match(text, /\(<[^|]+\|VA-1>, <[^|]+\|VA-2>, <[^|]+\|VA-3>\)$/);
});

// Slack's mrkdwn reserves & < >; blocks are JSON and need no escaping at all.
test('buildReleaseMessage escapes markup in the text but leaves the blocks literal', () => {
  const sara: Contributor = { name: 'Sara & Co', login: 'sara', emails: [] };
  const { text, blocks } = buildReleaseMessage(
    input({
      displayName: 'Vast <Pay> & Co',
      prs: [pr(1, { branch: 'fix/x', contributors: [sara] })],
      summaries: { 1: 'totals < 0 & > 100' },
    }),
  );
  assert.equal(
    text,
    `• <${RELEASE_PR}|Vast &lt;Pay&gt; &amp; Co - hotfix/2.1.15> - Totals &lt; 0 &amp; &gt; 100 (@Sara &amp; Co)`,
  );
  assert.deepEqual(sectionOf(blocks), [
    { type: 'link', url: RELEASE_PR, text: 'Vast <Pay> & Co - hotfix/2.1.15' },
    { type: 'text', text: ' - Totals < 0 & > 100 (' },
    { type: 'text', text: '@Sara & Co' },
    { type: 'text', text: ')' },
  ]);
});
