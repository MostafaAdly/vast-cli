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
export declare function createStatusBoard(rows: number, stream?: BoardStream, paint?: (tone: Tone, text: string) => string): StatusBoard;
//# sourceMappingURL=status-board.d.ts.map