import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Sandbox the production lock before importing anything that reads it.
const SANDBOX = mkdtempSync(join(tmpdir(), 'vast-help-'));
process.env.VAST_CLI_HOME = SANDBOX;

const { renderRootHelp, columnWidth, commandRow, exampleRow, lockState, flowDiagram, WIDTH } =
  await import('../src/utils/help.js');
const { enableProduction, disableProduction } = await import('../src/config/production-lock.js');

/** Visible width, ignoring colour escapes. */
const plain = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '');

test('column width is the widest cell plus a gutter', () => {
  const rows = [
    { left: 'status', right: 'a' },
    { left: 'production', right: 'b' },
  ];
  assert.equal(columnWidth(rows), 'production'.length + 2);
});

test('command and example rows align to the given column', () => {
  const row = { left: 'status', right: 'does a thing' };
  assert.equal(plain(commandRow(row, 12)), '    status      does a thing');
  assert.equal(plain(exampleRow(row, 12)), '    status      does a thing');
});

test('the flow diagram names all three environments in order', () => {
  const flow = plain(flowDiagram());
  const d = flow.indexOf('develop');
  const s = flow.indexOf('staging');
  const p = flow.indexOf('production');
  assert.ok(d >= 0 && s > d && p > s, `out of order: ${flow}`);
});

test('lock state reflects the lock, and locked reads as the safe state', () => {
  disableProduction();
  assert.match(plain(lockState()), /● LOCKED — production deploys refused/);

  enableProduction('2026-08-04T00:00:00Z');
  assert.match(plain(lockState()), /● ENABLED — production deploys allowed/);

  disableProduction();
});

test('help lists every command', () => {
  const out = plain(renderRootHelp('1.0.0'));
  for (const cmd of ['init', 'clone', 'status', 'promote', 'release', 'deploy', 'workflow', 'production']) {
    assert.ok(new RegExp(`\\b${cmd}\\b`).test(out), `${cmd} missing from help`);
  }
});

test('help shows the version and the section headings', () => {
  const out = plain(renderRootHelp('9.9.9'));
  assert.ok(out.includes('v9.9.9'));
  for (const section of [
    'THE EVERYDAY FLOW',
    'INSPECT',
    'SHIP',
    'SAFETY',
    'EXAMPLES',
    'GLOBAL OPTIONS',
  ]) {
    assert.ok(out.includes(section), `${section} missing`);
  }
});

test('help carries worked examples with their derived versions', () => {
  const out = plain(renderRootHelp('1.0.0'));
  assert.ok(out.includes('1.5.5-rc15 → 1.5.5-rc16'), 'default rc example missing');
  assert.ok(out.includes('1.5.5-rc15 → 1.6.0-rc1'), 'bump example missing');
});

// The whole screen is useless if it wraps in a standard terminal.
test('no line exceeds 80 visible columns', () => {
  for (const line of renderRootHelp('1.0.0').split('\n')) {
    const width = plain(line).length;
    assert.ok(width <= 80, `line is ${width} cols: ${plain(line)}`);
  }
});

test('the declared target width leaves headroom under 80', () => {
  assert.ok(WIDTH <= 80);
});

process.on('exit', () => rmSync(SANDBOX, { recursive: true, force: true }));
