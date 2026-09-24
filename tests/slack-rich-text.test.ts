import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bullet, bulletBlocks, escapeMrkdwn } from '../src/utils/slack-rich-text.js';

const clickup = (id: string): string => `https://app.clickup.com/t/90121402342/${id}`;

test('a bullet carries the link, description, people and tickets as text and elements', () => {
  const b = bullet({
    url: 'https://example.com/pr/1',
    label: 'App - hotfix/1.0.1',
    description: 'Guest token reuse',
    people: [{ userId: 'U1' }, { plain: '@Osama Elshimy' }],
    tickets: ['VA-1'],
  });
  assert.equal(
    b.text,
    `• <https://example.com/pr/1|App - hotfix/1.0.1> - Guest token reuse (<@U1>, @Osama Elshimy) (<${clickup('VA-1')}|VA-1>)`,
  );
  assert.deepEqual(b.elements, [
    { type: 'link', url: 'https://example.com/pr/1', text: 'App - hotfix/1.0.1' },
    { type: 'text', text: ' - Guest token reuse (' },
    { type: 'user', user_id: 'U1' },
    { type: 'text', text: ', ' },
    { type: 'text', text: '@Osama Elshimy' },
    { type: 'text', text: ') (' },
    { type: 'link', url: clickup('VA-1'), text: 'VA-1' },
    { type: 'text', text: ')' },
  ]);
});

test('bulletBlocks puts every bullet in one list, under an optional bold heading', () => {
  const a = bullet({ url: 'u1', label: 'A', description: 'x', people: [], tickets: [] });
  const b = bullet({ url: 'u2', label: 'B', description: 'y', people: [], tickets: [] });
  assert.deepEqual(bulletBlocks([a, b]), [
    {
      type: 'rich_text',
      elements: [
        {
          type: 'rich_text_list',
          style: 'bullet',
          elements: [
            { type: 'rich_text_section', elements: a.elements },
            { type: 'rich_text_section', elements: b.elements },
          ],
        },
      ],
    },
  ]);
  const withHeading = bulletBlocks([a], 'Pending for production') as Array<{ elements: unknown[] }>;
  assert.deepEqual(withHeading[0].elements[0], {
    type: 'rich_text_section',
    elements: [{ type: 'text', text: 'Pending for production', style: { bold: true } }],
  });
});

test('mrkdwn escaping covers exactly & < >', () => {
  assert.equal(escapeMrkdwn('a & <b> c'), 'a &amp; &lt;b&gt; c');
});
