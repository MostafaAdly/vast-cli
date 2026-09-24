import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hyperlink, terminalStyle } from '../src/utils/pending-style.js';
import { PLAIN_STYLE } from '../src/utils/pending-report.js';

test('a hyperlink is an OSC 8 escape around the text', () => {
  assert.equal(hyperlink('#313', 'https://x/pull/313'), '\u001B]8;;https://x/pull/313\u001B\\#313\u001B]8;;\u001B\\');
});

test('output that is not a terminal gets the plain style', () => {
  assert.equal(terminalStyle({ isTTY: false, noColor: false, colorLevel: 3 }), PLAIN_STYLE);
});

test('a terminal gets links, and colour unless NO_COLOR or no colour support', () => {
  const coloured = terminalStyle({ isTTY: true, noColor: false, colorLevel: 3 });
  assert.equal(coloured.link('a', 'u'), hyperlink('a', 'u'));
  assert.notEqual(coloured.paint('pr', '#1'), '#1');
  assert.match(coloured.paint('pr', '#1'), /#1/);

  const noColour = terminalStyle({ isTTY: true, noColor: true, colorLevel: 3 });
  assert.equal(noColour.paint('pr', '#1'), '#1');
  assert.equal(noColour.link('a', 'u'), hyperlink('a', 'u'));

  assert.equal(terminalStyle({ isTTY: true, noColor: false, colorLevel: 0 }).paint('stale', 'x'), 'x');
});

test('every tone has a colour', () => {
  const s = terminalStyle({ isTTY: true, noColor: false, colorLevel: 3 });
  for (const tone of ['repo', 'muted', 'inFlight', 'waiting', 'direct', 'reverse', 'pr', 'phrase', 'ticket', 'sha', 'stale', 'ported', 'notFound', 'error', 'ok'] as const) {
    assert.notEqual(s.paint(tone, 'x'), 'x', tone);
  }
});
