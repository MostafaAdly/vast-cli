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
export interface RunStatus {
    /** queued | in_progress | completed | waiting | requested | pending */
    status: string;
    /** success | failure | cancelled | timed_out | ...; null until completed. */
    conclusion: string | null;
}
export interface PollDeps {
    getStatus: () => Promise<RunStatus>;
    sleep: (ms: number) => Promise<void>;
    now: () => number;
    print: (line: string) => void;
}
export interface PollTiming {
    pollMs: number;
    heartbeatMs: number;
    /** Consecutive failed reads before giving up on the run. */
    maxConsecutiveErrors: number;
}
/**
 * 5s is close to `gh run watch`'s 3s refresh, so completion is seen almost as
 * fast. Twelve consecutive read errors is a minute of a dead API, which is
 * long enough to ride out a blip and short enough not to hang a release.
 */
export declare const DEFAULT_TIMING: PollTiming;
export interface PollResult {
    ok: boolean;
    /** The run's conclusion, or null if it never completed. */
    conclusion: string | null;
    elapsedMs: number;
    /** Set when polling gave up on read errors. */
    error?: string;
}
/** 0s, 42s, 1m05s, 1h02m03s. */
export declare function formatElapsed(ms: number): string;
/**
 * Watch one run until it completes or its status cannot be read any more.
 *
 * Prints only on a status change or when a heartbeat is due; the completion
 * line is the caller's, since only it knows how to colour success or failure.
 */
export declare function pollRun(label: string, runId: number, deps: PollDeps, timing?: PollTiming): Promise<PollResult>;
//# sourceMappingURL=run-poll.d.ts.map