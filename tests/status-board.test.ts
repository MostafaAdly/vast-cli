import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createStatusBoard, type BoardStream, type Tone } from '../src/utils/status-board.js';

/**
 * A stand-in for process.stdout that records every write, so a test can assert
 * on the exact escape sequences instead of trying to read a real terminal.
 */
function fakeStream(opts: { isTTY?: boolean; columns?: number } = {}): {
  stream: BoardStream;
  writes: string[];
} {
  const writes: string[] = [];
  const stream: BoardStream = {
    isTTY: opts.isTTY,
    columns: opts.columns,
    write: (chunk: string): boolean => {
      writes.push(chunk);
      return true;
    },
  };
  return { stream, writes };
}

/** Identity paint - keeps assertions about the escape sequence readable. */
const plain = (_tone: Tone, text: string): string => text;

/** Makes the tone visible in the output so a test can assert on it. */
const tagged = (tone: Tone, text: string): string => `<${tone}>${text}</${tone}>`;

test('non-TTY: creation writes nothing and update appends a plain line', () => {
  const { stream, writes } = fakeStream({ isTTY: false, columns: 80 });
  const board = createStatusBoard(3, stream, plain);

  assert.deepEqual(writes, []);

  board.update(1, 'building');
  assert.deepEqual(writes, ['building\n']);
});

test('TTY: creation reserves the block with one write of rows newlines', () => {
  const { stream, writes } = fakeStream({ isTTY: true, columns: 80 });
  createStatusBoard(3, stream, plain);

  assert.deepEqual(writes, ['\n\n\n']);
});

test('TTY: update moves up to the row, clears it, and comes back', () => {
  const { stream, writes } = fakeStream({ isTTY: true, columns: 80 });
  const board = createStatusBoard(3, stream, plain);
  writes.length = 0;

  board.update(0, 'a');
  board.update(2, 'c');

  assert.deepEqual(writes, ['\x1b[3A\r\x1b[2Ka\x1b[3B\r', '\x1b[1A\r\x1b[2Kc\x1b[1B\r']);
});

test('TTY: text is truncated to one short of the terminal width', () => {
  const { stream, writes } = fakeStream({ isTTY: true, columns: 20 });
  const board = createStatusBoard(1, stream, plain);
  writes.length = 0;

  board.update(0, 'x'.repeat(50));

  assert.deepEqual(writes, [`\x1b[1A\r\x1b[2K${'x'.repeat(19)}\x1b[1B\r`]);
});

test('TTY: an unknown terminal width is assumed to be 80 columns', () => {
  const { stream, writes } = fakeStream({ isTTY: true });
  const board = createStatusBoard(1, stream, plain);
  writes.length = 0;

  board.update(0, 'y'.repeat(100));

  assert.deepEqual(writes, [`\x1b[1A\r\x1b[2K${'y'.repeat(79)}\x1b[1B\r`]);
});

test('the tone is applied through paint, defaulting to muted', () => {
  const { stream, writes } = fakeStream({ isTTY: false });
  const board = createStatusBoard(2, stream, tagged);

  board.update(0, 'done', 'success');
  board.update(1, 'boom', 'error');
  board.update(0, 'waiting');

  assert.deepEqual(writes, [
    '<success>done</success>\n',
    '<error>boom</error>\n',
    '<muted>waiting</muted>\n',
  ]);
});

test('truncation happens before painting, so an escape code is never cut', () => {
  const { stream, writes } = fakeStream({ isTTY: true, columns: 20 });
  const board = createStatusBoard(1, stream, tagged);
  writes.length = 0;

  board.update(0, 'z'.repeat(50));

  assert.deepEqual(writes, [`\x1b[1A\r\x1b[2K<muted>${'z'.repeat(19)}</muted>\x1b[1B\r`]);
});

test('a board with no rows never writes anything', () => {
  const { stream, writes } = fakeStream({ isTTY: true, columns: 80 });
  const board = createStatusBoard(0, stream, plain);

  board.update(0, 'anything');

  assert.deepEqual(writes, []);
});

test('an out-of-range row is ignored', () => {
  const { stream, writes } = fakeStream({ isTTY: true, columns: 80 });
  const board = createStatusBoard(3, stream, plain);
  writes.length = 0;

  board.update(5, 'nowhere');
  board.update(-1, 'nowhere');

  assert.deepEqual(writes, []);
});

test('an out-of-range row is ignored when piped too', () => {
  const { stream, writes } = fakeStream({ isTTY: false });
  const board = createStatusBoard(3, stream, plain);

  board.update(3, 'nowhere');

  assert.deepEqual(writes, []);
});
