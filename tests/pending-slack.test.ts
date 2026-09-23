import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPendingSlack, pendingContributors } from '../src/utils/pending-slack.js';
import { contributorKey } from '../src/utils/contributors.js';
import { fixtureRepo, fixtureReport, OSAMA, MOSTAFA } from './pending-fixtures.js';

const COMPARE = 'https://github.com/Vast-menu/VastPayPwaV2/compare/production...staging';
const clickup = (id: string): string => `https://app.clickup.com/t/90121402342/${id}`;

test('one bullet per repo: phrases in PR order, people, tickets, compare link', () => {
  const msg = buildPendingSlack(fixtureReport(), { [contributorKey(OSAMA)]: 'U2' })!;
  assert.equal(
    msg.text,
    [
      '*Pending for production*',
      `• <${COMPARE}|Vastpay Pwa V2 - staging → production> - Old change, ELM single charge, guest token reuse (<@U2>, @Mostafa Adly) (<${clickup('VA-13091')}|VA-13091>)`,
    ].join('\n'),
  );
  const blocks = msg.blocks as Array<{ elements: Array<{ type: string; elements: Array<{ elements: unknown[] }> }> }>;
  assert.equal(blocks[0].elements[1].type, 'rich_text_list');
  assert.equal(blocks[0].elements[1].elements.length, 1);
  assert.deepEqual(blocks[0].elements[1].elements[0].elements[0], {
    type: 'link',
    url: COMPARE,
    text: 'Vastpay Pwa V2 - staging → production',
  });
});

test('the reverse direction is never posted', () => {
  const msg = buildPendingSlack(fixtureReport(), {})!;
  assert.doesNotMatch(msg.text, /send-OTP|memory request/);
});

test('repos with nothing pending are left out, and nothing at all means no message', () => {
  const empty = fixtureRepo();
  empty.forward = { ...empty.forward!, inFlight: [], waiting: [], direct: [] };
  assert.equal(buildPendingSlack(fixtureReport([empty]), {}), null);
  const msg = buildPendingSlack(fixtureReport([empty, fixtureRepo()]), {})!;
  assert.equal(msg.text.split('\n').length, 2);
});

test('contributors come from the forward direction only', () => {
  const people = pendingContributors(fixtureReport()).map((c) => c.name);
  assert.deepEqual(people.sort(), [MOSTAFA.name, OSAMA.name].sort());
});
