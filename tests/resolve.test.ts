import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SANDBOX = mkdtempSync(join(tmpdir(), 'vast-res-'));
process.env.VAST_CLI_HOME = SANDBOX;

const { writeConfig, readConfig, resolveRepoDir } = await import('../src/config/workspace.js');
const { clearDiscoveryCache } = await import('../src/utils/discover.js');

// Sweeps are memoized per process, so a test that creates checkouts after an
// earlier test swept must start from a clean memo.
beforeEach(() => clearDiscoveryCache());

function makeRepo(parent: string, name: string, origin: string): string {
  const dir = join(parent, name);
  mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['remote', 'add', 'origin', origin], { cwd: dir, stdio: 'pipe' });
  return dir;
}

test('returns the cached path when it is still valid', () => {
  const root = mkdtempSync(join(tmpdir(), 'vast-res-a-'));
  try {
    const dir = makeRepo(root, 'whatever', 'https://github.com/vast-menu/vastpaypwa');
    writeConfig({ repos: { VastPayPwa: dir }, searchRoots: [root] });
    assert.equal(resolveRepoDir('VastPayPwa'), dir);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// A moved or deleted clone must not become a permanent dead end.
test('re-discovers when the cached path no longer exists', () => {
  const root = mkdtempSync(join(tmpdir(), 'vast-res-b-'));
  try {
    const dir = makeRepo(root, 'moved-here', 'https://github.com/vast-menu/vastpaypwa');
    writeConfig({ repos: { VastPayPwa: '/gone/missing' }, searchRoots: [root] });
    assert.equal(resolveRepoDir('VastPayPwa'), dir);
    // Persisting the repair is the whole point: without it every later command
    // pays another full disk sweep for a path we already worked out.
    assert.equal(readConfig().repos.VastPayPwa, dir, 'the repaired path must be written back');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('re-discovers when the cached path is now a different repo', () => {
  const root = mkdtempSync(join(tmpdir(), 'vast-res-c-'));
  try {
    makeRepo(root, 'wrong', 'https://github.com/vast-menu/vastmenupwa');
    const right = makeRepo(root, 'right', 'https://github.com/vast-menu/vastpaypwa');
    writeConfig({ repos: { VastPayPwa: join(root, 'wrong') }, searchRoots: [root] });
    assert.equal(resolveRepoDir('VastPayPwa'), right);
    assert.equal(readConfig().repos.VastPayPwa, right, 'the repaired path must be written back');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('returns null when the repo is nowhere to be found', () => {
  const root = mkdtempSync(join(tmpdir(), 'vast-res-d-'));
  try {
    writeConfig({ repos: {}, searchRoots: [root] });
    assert.equal(resolveRepoDir('VastPayPwa'), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// Otherwise the dead entry survives forever and every later call re-sweeps
// the disk to fail in exactly the same way.
test('drops the entry when the cached path is dead and re-discovery finds nothing', () => {
  const root = mkdtempSync(join(tmpdir(), 'vast-res-e-'));
  try {
    writeConfig({ repos: { VastPayPwa: join(root, 'gone') }, searchRoots: [root] });
    assert.equal(resolveRepoDir('VastPayPwa'), null);
    assert.equal('VastPayPwa' in readConfig().repos, false, 'the dead entry must be deleted');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

process.on('exit', () => rmSync(SANDBOX, { recursive: true, force: true }));
