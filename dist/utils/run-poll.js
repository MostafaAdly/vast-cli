/**
 * Polls a GitHub Actions run to completion.
 *
 * The multi-repo release watches several runs at once, and `gh run watch`
 * cannot do that: it blocks the whole process and repaints the terminal, so
 * two of them freeze each other and fight over the screen. This reads the
 * run's status on an interval instead and prints one plain line when the
 * status changes, plus a heartbeat so a long build never looks hung.
 *
 * Every side effect is injected — the status read, the clock, the sleep, the
 * printer — so the loop is tested against a scripted run, not against GitHub.
 */
/**
 * 5s is close to `gh run watch`'s 3s refresh, so completion is seen almost as
 * fast. Twelve consecutive read errors is a minute of a dead API, which is
 * long enough to ride out a blip and short enough not to hang a release.
 */
export const DEFAULT_TIMING = {
    pollMs: 5000,
    heartbeatMs: 30000,
    maxConsecutiveErrors: 12,
};
/** 0s, 42s, 1m05s, 1h02m03s. */
export function formatElapsed(ms) {
    const total = Math.floor(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = (n) => String(n).padStart(2, '0');
    if (h > 0)
        return `${h}h${pad(m)}m${pad(s)}s`;
    if (m > 0)
        return `${m}m${pad(s)}s`;
    return `${s}s`;
}
/**
 * Watch one run until it completes or its status cannot be read any more.
 *
 * Prints on a status change, when a heartbeat is due, or when a streak of
 * failed reads begins; the completion line is the caller's, since only it
 * knows how to colour success or failure.
 */
export async function pollRun(label, runId, deps, timing = DEFAULT_TIMING) {
    const start = deps.now();
    let lastStatus = null;
    let lastPrintedAt = 0;
    let consecutiveErrors = 0;
    for (;;) {
        let current = null;
        try {
            current = await deps.getStatus();
            consecutiveErrors = 0;
        }
        catch (error) {
            consecutiveErrors++;
            // Say something the first time a streak starts: otherwise a dead API is a
            // silent minute followed by a failure, which reads as a hang. Only the
            // first, so a long outage does not scroll one line per retry.
            if (consecutiveErrors === 1) {
                deps.print(`  ${label}  run ${runId}  status read failed, retrying  ${formatElapsed(deps.now() - start)}`);
            }
            if (consecutiveErrors >= timing.maxConsecutiveErrors) {
                return {
                    ok: false,
                    conclusion: null,
                    elapsedMs: deps.now() - start,
                    error: `could not read run status: ${error instanceof Error ? error.message : String(error)}`,
                };
            }
        }
        if (current) {
            const elapsed = deps.now() - start;
            if (current.status === 'completed') {
                return { ok: current.conclusion === 'success', conclusion: current.conclusion, elapsedMs: elapsed };
            }
            if (current.status !== lastStatus || elapsed - lastPrintedAt >= timing.heartbeatMs) {
                deps.print(`  ${label}  run ${runId}  ${current.status}  ${formatElapsed(elapsed)}`);
                lastStatus = current.status;
                lastPrintedAt = elapsed;
            }
        }
        await deps.sleep(timing.pollMs);
    }
}
//# sourceMappingURL=run-poll.js.map