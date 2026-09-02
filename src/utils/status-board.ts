/**
 * A fixed block of terminal lines, one per watched CI run.
 *
 * A multi-repo release watches several runs at once, and printing a new line
 * on every status change buries the current state under its own history: by
 * the end of a slow build the screen is a wall of near-identical lines and you
 * have to read backwards to find where each repo actually stands. So each run
 * owns one line here, rewritten in place, and the block stays as tall as the
 * number of runs.
 *
 * That only works on a terminal. When the output is piped - a log file, a CI
 * job, Claude running the CLI - cursor movement means nothing and the escape
 * codes would just be noise in the transcript, so the board falls back to the
 * plain appended lines it printed before.
 *
 * Text is truncated to one column short of the terminal width. A line that
 * wraps occupies two physical rows, which silently shifts everything below it
 * and makes the up/down cursor arithmetic point at the wrong lines from then
 * on. The truncation is done on the plain text, before painting, so a colour
 * escape sequence is never cut in half.
 */

import { colors } from './ui.js';

export type Tone = 'muted' | 'success' | 'error';

/** One terminal line per watched run, rewritten in place on a TTY; plain appended lines otherwise. */
export interface StatusBoard {
  update(row: number, text: string, tone?: Tone): void;
}

/** The bits of process.stdout the board needs, so tests can hand it a fake. */
export interface BoardStream {
  isTTY?: boolean;
  columns?: number;
  write(chunk: string): unknown;
}

/** Assumed terminal width when the stream does not report one. */
const DEFAULT_COLUMNS = 80;

function defaultPaint(tone: Tone, text: string): string {
  if (tone === 'success') return colors.success(text);
  if (tone === 'error') return colors.error(text);
  return colors.muted(text);
}

export function createStatusBoard(
  rows: number,
  stream: BoardStream = process.stdout,
  paint: (tone: Tone, text: string) => string = defaultPaint,
): StatusBoard {
  const tty = stream.isTTY === true && rows > 0;

  // Reserve the block up front so the lines exist to move back into. The
  // cursor ends at column 0 on the line just below the block, which is what
  // the row arithmetic in update() measures from.
  if (tty) stream.write('\n'.repeat(rows));

  return {
    update(row: number, text: string, tone: Tone = 'muted'): void {
      if (rows === 0 || row < 0 || row >= rows) return;

      if (!tty) {
        stream.write(`${paint(tone, text)}\n`);
        return;
      }

      const width = (stream.columns ?? DEFAULT_COLUMNS) - 1;
      const painted = paint(tone, text.slice(0, width));
      const up = rows - row;

      // Up to the row, back to column 0, clear it, write, then down again -
      // one write so a concurrent printer cannot land mid-sequence.
      stream.write(`\x1b[${up}A\r\x1b[2K${painted}\x1b[${up}B\r`);
    },
  };
}
