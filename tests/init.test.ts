import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickShortest } from '../src/commands/init.js';

// Non-interactive runs must be deterministic and must announce their choice,
// so a wrong guess is visible rather than mysterious.
test('picks the shortest path when several checkouts claim one repo', () => {
  assert.equal(
    pickShortest(['/a/very/long/path/vastmenu-api-test', '/a/vastmenu-api']),
    '/a/vastmenu-api',
  );
});

test('ties break deterministically on sort order, never at random', () => {
  const a = pickShortest(['/x/bbb', '/x/aaa']);
  const b = pickShortest(['/x/aaa', '/x/bbb']);
  assert.equal(a, b);
  assert.equal(a, '/x/aaa');
});

test('a single candidate is returned as-is', () => {
  assert.equal(pickShortest(['/only/one']), '/only/one');
});
