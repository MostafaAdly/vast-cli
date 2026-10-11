import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { NO_EVENTS, doneEvent, ndjsonSink, type VastEvent } from '../src/utils/events.js';

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
