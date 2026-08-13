import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commonParent } from '../src/commands/clone.js';

test('finds the parent shared by every path', () => {
  assert.equal(
    commonParent(['/Users/x/work/vastpay-pwa', '/Users/x/work/vastmenu-pwa']),
    '/Users/x/work',
  );
});

test('picks the most common parent when repos are scattered', () => {
  assert.equal(
    commonParent([
      '/Users/x/work/a',
      '/Users/x/work/b',
      '/Users/x/work/c',
      '/Users/x/elsewhere/d',
    ]),
    '/Users/x/work',
  );
});

test('returns null when there is nothing to go on', () => {
  assert.equal(commonParent([]), null);
});

test('a single repo still yields its parent', () => {
  assert.equal(commonParent(['/Users/x/work/only']), '/Users/x/work');
});
