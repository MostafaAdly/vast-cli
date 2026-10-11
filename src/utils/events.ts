/**
 * What `vast release --json` and `vast promote --json` stream, one JSON object
 * per line, for the Vast Bar app (and any script) to follow a run live.
 *
 * Events are emitted from the same call sites that update the status board and
 * build the outcomes the summary prints, so the stream and the terminal can
 * never tell two different stories. Without --json the sink is a no-op.
 */

import type { DeployOutcome } from '../commands/deploy.js';
import { firstLine, reportUnexpectedError } from './errors.js';

/** Where a repo's develop → staging promotion stands when its plan is reported. */
export type PromoteState = 'will merge' | 'merged' | 'nothing to promote' | 'no develop' | 'not run';

/** What happened to a release announcement: the text is always there, posted or not. */
export interface SlackResult {
  text: string;
  posted: boolean;
  error: string | null;
}

export type VastEvent =
  | { type: 'start'; command: 'release' | 'promote'; args: string[]; dryRun: boolean; repos: string[] }
  | {
      type: 'plan';
      repo: string;
      ok: boolean;
      version: string;
      commits: number | null;
      promote: PromoteState;
      notice: string | null;
      detail: string | null;
    }
  | { type: 'promoted'; repo: string; commits: number }
  | { type: 'dispatched'; repo: string; version: string; runId: number; runUrl: string }
  | { type: 'run'; repo: string; status: string; conclusion: string | null; elapsedMs: number }
  | { type: 'rollout'; repo: string; state: string; reason: string | null; elapsedMs: number }
  | { type: 'pr'; repo: string; branch: string; url: string | null; version: string; slack: SlackResult | null }
  | { type: 'done'; repo: string; version: string; status: 'released' | 'skipped' | 'failed'; detail: string }
  | { type: 'end'; exitCode: number };

export interface EventSink {
  emit(event: VastEvent): void;
}

export const NO_EVENTS: EventSink = { emit: () => {} };

/** One line per event, flushed as it happens, each stamped with when it happened. */
export function ndjsonSink(
  write: (line: string) => void = (line) => {
    process.stdout.write(line);
  },
  now: () => Date = () => new Date(),
): EventSink {
  return { emit: (event) => write(`${JSON.stringify({ ...event, at: now().toISOString() })}\n`) };
}

/**
 * A sink whose failures are swallowed: a broken stdout costs the event, never
 * the release, and never the sibling repos' outcomes.
 */
export function guardedSink(sink: EventSink): EventSink {
  return {
    emit: (event) => {
      try {
        sink.emit(event);
      } catch {
        // Deliberately swallowed; see above.
      }
    },
  };
}

/**
 * Run a --json command so that `end` is always its last line. A throw nothing
 * else caught prints what the global handler prints (on stderr) and ends the
 * stream with exitCode 1, rather than leaving the app with a run that never ends.
 */
export async function streamToEnd(events: EventSink, run: () => Promise<number>): Promise<number> {
  let code: number;
  try {
    code = await run();
  } catch (error) {
    reportUnexpectedError(error);
    code = 1;
  }
  events.emit({ type: 'end', exitCode: code });
  return code;
}

/**
 * The outcome the summary prints, as an event. Its detail is one line: a
 * thrown error's full text stays on stderr, the stream carries the headline.
 */
export function doneEvent(outcome: DeployOutcome): VastEvent {
  return {
    type: 'done',
    repo: outcome.repo,
    version: outcome.version,
    status: outcome.status,
    detail: firstLine(outcome.detail),
  };
}
