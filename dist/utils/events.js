/**
 * What `vast release --json` and `vast promote --json` stream, one JSON object
 * per line, for the Vast Bar app (and any script) to follow a run live.
 *
 * Events are emitted from the same call sites that update the status board and
 * build the outcomes the summary prints, so the stream and the terminal can
 * never tell two different stories. Without --json the sink is a no-op.
 */
import { firstLine, reportUnexpectedError } from './errors.js';
export const NO_EVENTS = { emit: () => { } };
/** One line per event, flushed as it happens, each stamped with when it happened. */
export function ndjsonSink(write = (line) => {
    process.stdout.write(line);
}, now = () => new Date()) {
    return { emit: (event) => write(`${JSON.stringify({ ...event, at: now().toISOString() })}\n`) };
}
/**
 * A sink whose failures are swallowed: a broken stdout costs the event, never
 * the release, and never the sibling repos' outcomes.
 */
export function guardedSink(sink) {
    return {
        emit: (event) => {
            try {
                sink.emit(event);
            }
            catch {
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
export async function streamToEnd(events, run) {
    let code;
    try {
        code = await run();
    }
    catch (error) {
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
export function doneEvent(outcome) {
    return {
        type: 'done',
        repo: outcome.repo,
        version: outcome.version,
        status: outcome.status,
        detail: firstLine(outcome.detail),
    };
}
//# sourceMappingURL=events.js.map