import { test } from 'node:test';
import assert from 'node:assert/strict';
import { homedir, tmpdir } from 'node:os';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { rootsFor, isTooBroadToScan } from '../src/utils/discover.js';

// Walking / or $HOME at depth 4 sweeps the whole machine.
test('refuses to treat / or $HOME as a scan root', () => {
  assert.equal(isTooBroadToScan('/'), true);
  assert.equal(isTooBroadToScan(homedir()), true);
  assert.equal(isTooBroadToScan(resolve(homedir(), '..')), true);
});

test('a specific directory is fine to scan', () => {
  assert.equal(isTooBroadToScan(tmpdir()), false);
});

test('the current directory becomes a search root', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vast-roots-'));
  try {
    assert.ok(rootsFor([], dir, []).includes(resolve(dir)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The whole point of the guard: standing in $HOME must not trigger a full sweep.
test('the current directory is skipped when it is too broad', () => {
  assert.deepEqual(rootsFor([], homedir(), []), []);
  assert.deepEqual(rootsFor([], '/', []), []);
});

test('explicit --root paths are included', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vast-roots-'));
  try {
    assert.ok(rootsFor([dir], '/', []).includes(resolve(dir)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Naming a directory is deliberate, so honour it even if a bare cwd would not be.
test('an explicit --root is honoured even when broad', () => {
  assert.ok(rootsFor([homedir()], '/', []).includes(homedir()));
});

test('relative --root paths are resolved to absolute', () => {
  const roots = rootsFor(['.'], '/', []);
  for (const r of roots) assert.ok(r.startsWith('/'), `${r} should be absolute`);
});

test('base roots are kept alongside the new ones', () => {
  const a = mkdtempSync(join(tmpdir(), 'vast-roots-a-'));
  const b = mkdtempSync(join(tmpdir(), 'vast-roots-b-'));
  try {
    const roots = rootsFor([b], '/', [a]);
    assert.ok(roots.includes(a));
    assert.ok(roots.includes(resolve(b)));
  } finally {
    rmSync(a, { recursive: true, force: true });
    rmSync(b, { recursive: true, force: true });
  }
});

test('duplicates collapse', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vast-roots-'));
  try {
    const roots = rootsFor([dir, dir], dir, [dir]);
    assert.equal(roots.filter((r) => r === resolve(dir)).length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('roots that do not exist are dropped', () => {
  assert.deepEqual(rootsFor(['/definitely/not/here'], '/', []), []);
});

test('a nested root under an existing one is still listed', () => {
  const base = mkdtempSync(join(tmpdir(), 'vast-roots-'));
  const nested = join(base, 'deep');
  mkdirSync(nested);
  try {
    const roots = rootsFor([nested], '/', [base]);
    assert.ok(roots.includes(base) && roots.includes(resolve(nested)));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
