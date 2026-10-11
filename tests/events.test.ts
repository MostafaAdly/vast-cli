import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { NO_EVENTS, doneEvent, guardedSink, ndjsonSink, streamToEnd, type VastEvent } from '../src/utils/events.js';

test('the NDJSON sink writes one JSON object per line, stamped with the time', () => {
  const lines: string[] = [];
  const sink = ndjsonSink((l) => lines.push(l), () => new Date('2026-10-11T09:00:00.000Z'));
  sink.emit({ type: 'promoted', repo: 'VastPayPwa', commits: 3 });
  sink.emit({ type: 'end', exitCode: 0 });
  assert.equal(lines.length, 2);
  for (const l of lines) assert.ok(l.endsWith('\n') && !l.slice(0, -1).includes('\n'), 'exactly one line per event');
  assert.deepEqual(JSON.parse(lines[0]), { type: 'promoted', repo: 'VastPayPwa', commits: 3, at: '2026-10-11T09:00:00.000Z' });
  assert.deepEqual(JSON.parse(lines[1]), { type: 'end', exitCode: 0, at: '2026-10-11T09:00:00.000Z' });
});

test('the no-op sink accepts every event and writes nothing', () => {
  const event: VastEvent = { type: 'end', exitCode: 1 };
  assert.doesNotThrow(() => NO_EVENTS.emit(event));
});

test('a done event carries the outcome the summary prints', () => {
  assert.deepEqual(
    doneEvent({ repo: 'VastMenuPwa', version: '1.6.13-rc1', status: 'failed', detail: 'run 9 failed — url' }),
    { type: 'done', repo: 'VastMenuPwa', version: '1.6.13-rc1', status: 'failed', detail: 'run 9 failed — url' },
  );
});

test('a done event carries only the first line of a multi-line error', () => {
  const done = doneEvent({
    repo: 'VastMenuPwa',
    version: '1.6.13-rc1',
    status: 'failed',
    detail: 'Command failed: gh workflow run build-deploy.yml\nHTTP 422: Unexpected inputs',
  });
  assert.ok(done.type === 'done');
  assert.equal(done.detail, 'Command failed: gh workflow run build-deploy.yml');
});

test('a guarded sink swallows a write that throws', () => {
  const sink = guardedSink({
    emit: () => {
      throw new Error('EPIPE');
    },
  });
  assert.doesNotThrow(() => sink.emit({ type: 'end', exitCode: 0 }));
});

test('a stream whose run throws still ends with end, exit code 1', async () => {
  const seen: VastEvent[] = [];
  const code = await streamToEnd({ emit: (e) => seen.push(e) }, async () => {
    seen.push({ type: 'start', command: 'promote', args: [], dryRun: true, repos: ['VastPayPwa'] });
    throw new Error('boom');
  });
  assert.equal(code, 1);
  assert.deepEqual(seen.map((e) => e.type), ['start', 'end']);
  assert.deepEqual(seen.at(-1), { type: 'end', exitCode: 1 });
});

test('a stream that returns ends with end carrying its exit code', async () => {
  const seen: VastEvent[] = [];
  assert.equal(await streamToEnd({ emit: (e) => seen.push(e) }, async () => 0), 0);
  assert.deepEqual(seen, [{ type: 'end', exitCode: 0 }]);
});

// In a real process, because the point is what reaches file descriptor 1.
test('in --json mode human output goes to stderr and stdout keeps only machine output', () => {
  const script = [
    "const m = await import('./src/utils/json-mode.ts');",
    'm.routeHumanOutputToStderr();',
    "console.log('human log');",
    "console.info('human info');",
    "console.warn('human warn');",
    "process.stdout.write('{\"machine\":true}\\n');",
  ].join('\n');
  const r = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
    encoding: 'utf-8',
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '{"machine":true}\n');
  assert.match(r.stderr, /human log\nhuman info\nhuman warn\n/);
});
