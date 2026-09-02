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
export const DEFAULT_TIMING: PollTiming = {
  pollMs: 5000,
  heartbeatMs: 30000,
  maxConsecutiveErrors: 12,
};

export interface PollResult {
  ok: boolean;
  /** The run's conclusion, or null if it never completed. */
  conclusion: string | null;
  elapsedMs: number;
  /** Set when polling gave up on read errors. */
  error?: string;
}

/** 0s, 42s, 1m05s, 1h02m03s. */
export function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number): string => String(n).padStart(2, '0');
  if (h > 0) return `${h}h${pad(m)}m${pad(s)}s`;
  if (m > 0) return `${m}m${pad(s)}s`;
  return `${s}s`;
}

/**
 * Watch one run until it completes or its status cannot be read any more.
 *
 * Prints only on a status change or when a heartbeat is due; the completion
 * line is the caller's, since only it knows how to colour success or failure.
 */
export async function pollRun(
  label: string,
  runId: number,
  deps: PollDeps,
  timing: PollTiming = DEFAULT_TIMING,
): Promise<PollResult> {
  const start = deps.now();
  let lastStatus: string | null = null;
  let lastPrintedAt = 0;
  let consecutiveErrors = 0;

  for (;;) {
    let current: RunStatus | null = null;
    try {
      current = await deps.getStatus();
      consecutiveErrors = 0;
    } catch (error) {
      consecutiveErrors++;
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
