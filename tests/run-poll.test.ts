import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pollRun, formatElapsed, type RunStatus } from '../src/utils/run-poll.js';

/**
 * A scripted GitHub: hands out the given statuses in order, repeating the
 * last one forever. A fake clock advances by exactly the slept duration, so
 * every assertion about heartbeats is about elapsed time, not wall time.
 */
function scripted(statuses: Array<RunStatus | Error>) {
  let clock = 0;
  let reads = 0;
  const lines: string[] = [];
  const deps = {
    getStatus: async (): Promise<RunStatus> => {
      const next = statuses[Math.min(reads, statuses.length - 1)];
      reads++;
      if (next instanceof Error) throw next;
      return next;
    },
    sleep: async (ms: number): Promise<void> => {
      clock += ms;
    },
    now: () => clock,
    print: (line: string): void => {
      lines.push(line);
    },
  };
  return { deps, lines, reads: () => reads };
}

const queued: RunStatus = { status: 'queued', conclusion: null };
const running: RunStatus = { status: 'in_progress', conclusion: null };
const success: RunStatus = { status: 'completed', conclusion: 'success' };
const failure: RunStatus = { status: 'completed', conclusion: 'failure' };

const timing = { pollMs: 5000, heartbeatMs: 30000, maxConsecutiveErrors: 3 };

test('resolves ok once the run completes with success', async () => {
  const { deps } = scripted([queued, running, success]);
  const result = await pollRun('VastPayPwa', 42, deps, timing);
  assert.equal(result.ok, true);
  assert.equal(result.conclusion, 'success');
});

test('a completed run with any other conclusion is not ok, and says which', async () => {
  const { deps } = scripted([running, failure]);
  const result = await pollRun('VastPayPwa', 42, deps, timing);
  assert.equal(result.ok, false);
  assert.equal(result.conclusion, 'failure');
});

test('polls at the given interval, so completion is seen within one poll', async () => {
  const { deps, reads } = scripted([running, running, running, success]);
  const result = await pollRun('VastPayPwa', 42, deps, timing);
  assert.equal(reads(), 4);
  assert.equal(result.elapsedMs, 3 * timing.pollMs);
});

test('prints a line when the status changes, and nothing while it holds', async () => {
  const { deps, lines } = scripted([queued, queued, queued, running, running, success]);
  await pollRun('VastPayPwa', 42, deps, timing);
  assert.deepEqual(lines, [
    '  VastPayPwa  run 42  queued  0s',
    '  VastPayPwa  run 42  in_progress  15s',
  ]);
});

test('prints a heartbeat every heartbeat interval while the status is unchanged', async () => {
  // 13 polls of in_progress spans 60s of fake time: change line at 0s, then
  // heartbeats at 30s and 60s. Completion itself is the caller's line.
  const { deps, lines } = scripted([...Array<RunStatus>(13).fill(running), success]);
  await pollRun('VastPayPwa', 42, deps, timing);
  assert.deepEqual(lines, [
    '  VastPayPwa  run 42  in_progress  0s',
    '  VastPayPwa  run 42  in_progress  30s',
    '  VastPayPwa  run 42  in_progress  1m00s',
  ]);
});

test('a transient error reading the status is retried, not fatal', async () => {
  const { deps } = scripted([running, new Error('gh: connection reset'), success]);
  const result = await pollRun('VastPayPwa', 42, deps, timing);
  assert.equal(result.ok, true);
});

test('gives up after too many consecutive read errors', async () => {
  const { deps, reads } = scripted([new Error('gh: down')]);
  const result = await pollRun('VastPayPwa', 42, deps, timing);
  assert.equal(result.ok, false);
  assert.equal(result.conclusion, null);
  assert.match(result.error ?? '', /gh: down/);
  assert.equal(reads(), timing.maxConsecutiveErrors);
});

test('a successful read resets the error count', async () => {
  const boom = new Error('gh: down');
  const { deps } = scripted([boom, boom, running, boom, boom, success]);
  const result = await pollRun('VastPayPwa', 42, deps, timing);
  assert.equal(result.ok, true);
});

test('formatElapsed reads like a stopwatch', () => {
  assert.equal(formatElapsed(0), '0s');
  assert.equal(formatElapsed(42_000), '42s');
  assert.equal(formatElapsed(65_000), '1m05s');
  assert.equal(formatElapsed(3_723_000), '1h02m03s');
});
