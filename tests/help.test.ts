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

test('a description too long for the screen continues on an aligned line', () => {
  const row = { left: 'release', right: 'a'.repeat(WIDTH) + ' tail' };
  const lines = plain(commandRow(row, 12)).split('\n');
  assert.equal(lines.length, 2);
  assert.ok(lines[1].startsWith(' '.repeat(16)), `not aligned: ${lines[1]}`);
  assert.equal(lines[1].trim(), 'tail');
});

test('the flow diagram names all three environments in order', () => {
  const flow = plain(flowDiagram());
  const d = flow.indexOf('develop');
  const s = flow.indexOf('staging');
  const p = flow.indexOf('production');
  assert.ok(d >= 0 && s > d && p > s, `out of order: ${flow}`);
});

test('the flow diagram offers no production deploy while it is blocked', () => {
  const flow = plain(flowDiagram());
  assert.ok(flow.includes('vast promote --to production'), 'promote hop missing');
  assert.ok(!flow.includes('vast deploy'), `deploy still offered: ${flow}`);
  assert.ok(flow.includes('(production deploy blocked until migrated)'), `no reason given: ${flow}`);
});

test('lock state reflects the lock once production is migrated', () => {
  assert.match(plain(lockState({ ready: true, enabled: false })), /● LOCKED — production deploys refused/);
  assert.match(plain(lockState({ ready: true, enabled: true })), /● ENABLED — production deploys allowed/);
});

test('the pipeline block outranks the lock, however the lock stands', () => {
  const blocked = /● BLOCKED — production not migrated \(lock ignored\)/;
  assert.match(plain(lockState({ ready: false, enabled: true })), blocked);
  assert.match(plain(lockState({ ready: false, enabled: false })), blocked);

  // And the real lock file, whichever way it is set, changes nothing today.
  enableProduction('2026-08-04T00:00:00Z');
  assert.match(plain(lockState()), blocked);
  disableProduction();
  assert.match(plain(lockState()), blocked);
});

test('help lists every command', () => {
  const out = plain(renderRootHelp('1.0.0'));
  for (const cmd of ['init', 'clone', 'upgrade', 'status', 'promote', 'release', 'deploy', 'argocd', 'workflow', 'production']) {
    assert.ok(new RegExp(`\\b${cmd}\\b`).test(out), `${cmd} missing from help`);
  }
});

test('help says production is blocked rather than merely locked', () => {
  const out = plain(renderRootHelp('1.0.0'));
  assert.ok(out.includes('BLOCKED'), 'production block missing from help');
});

test('help describes the deploy half of release and deploy', () => {
  const out = plain(renderRootHelp('1.0.0'));
  assert.ok(out.includes('wait for ArgoCD'), 'release does not mention the ArgoCD wait');
  assert.ok(out.includes('roll it out'), 'deploy does not mention the rollout');
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
test('no line exceeds the declared target width', () => {
  for (const line of renderRootHelp('1.0.0').split('\n')) {
    const width = plain(line).length;
    assert.ok(width <= WIDTH, `line is ${width} cols: ${plain(line)}`);
  }
});

test('the declared target width leaves headroom under 80', () => {
  assert.ok(WIDTH <= 80);
});

process.on('exit', () => rmSync(SANDBOX, { recursive: true, force: true }));
