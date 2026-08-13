import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Sandbox BEFORE importing, so a failing test can never touch the real config.
const SANDBOX = mkdtempSync(join(tmpdir(), 'vast-ws-'));
process.env.VAST_CLI_HOME = SANDBOX;

const {
  readConfig,
  writeConfig,
  setRepoPath,
  forgetRepoPath,
  addSearchRoot,
  cachedRepoPath,
  configPath,
} = await import('../src/config/workspace.js');

test('config lives under VAST_CLI_HOME', () => {
  assert.equal(configPath(), join(SANDBOX, 'config.json'));
});

test('reading a missing config yields empty defaults, not a throw', () => {
  const c = readConfig();
  assert.deepEqual(c.repos, {});
  assert.deepEqual(c.searchRoots, []);
});

test('writes and reads back', () => {
  writeConfig({ repos: { VastPayPwa: '/a/b' }, searchRoots: ['/a'], discoveredAt: 'now' });
  const c = readConfig();
  assert.equal(c.repos.VastPayPwa, '/a/b');
  assert.deepEqual(c.searchRoots, ['/a']);
});

test('setRepoPath merges without dropping the rest', () => {
  writeConfig({ repos: { VastPayPwa: '/a/b' }, searchRoots: ['/a'] });
  setRepoPath('VastMenuPwa', '/c/d');
  const c = readConfig();
  assert.equal(c.repos.VastPayPwa, '/a/b');
  assert.equal(c.repos.VastMenuPwa, '/c/d');
  assert.deepEqual(c.searchRoots, ['/a'], 'searchRoots must survive');
});

test('forgetRepoPath drops one entry and leaves the rest alone', () => {
  writeConfig({ repos: { VastPayPwa: '/a/b', VastMenuPwa: '/c/d' }, searchRoots: ['/a'] });
  forgetRepoPath('VastPayPwa');
  const c = readConfig();
  assert.equal('VastPayPwa' in c.repos, false);
  assert.equal(c.repos.VastMenuPwa, '/c/d');
  assert.deepEqual(c.searchRoots, ['/a'], 'searchRoots must survive');
});

test('forgetting an unknown repo is a no-op', () => {
  writeConfig({ repos: { VastPayPwa: '/a/b' }, searchRoots: ['/a'] });
  forgetRepoPath('Nope');
  assert.deepEqual(readConfig().repos, { VastPayPwa: '/a/b' });
});

// `vast clone --into ~/side` records the destination this way, so the next
// `vast init` sweeps it instead of losing everything cloned there.
test('addSearchRoot records a destination once and only once', () => {
  writeConfig({ repos: {}, searchRoots: ['/one'] });
  addSearchRoot('/two');
  addSearchRoot('/two');
  assert.deepEqual(readConfig().searchRoots, ['/one', '/two']);
});

test('addSearchRoot leaves the repo map alone', () => {
  writeConfig({ repos: { VastPayPwa: '/a/b' }, searchRoots: [] });
  addSearchRoot('/side');
  const c = readConfig();
  assert.deepEqual(c.repos, { VastPayPwa: '/a/b' });
  assert.deepEqual(c.searchRoots, ['/side']);
});

test('cachedRepoPath returns the stored path', () => {
  writeConfig({ repos: { VastPayPwa: '/a/b' }, searchRoots: [] });
  assert.equal(cachedRepoPath('VastPayPwa'), '/a/b');
  assert.equal(cachedRepoPath('Nope'), undefined);
});

// A hand-edited or truncated config must not brick every command.
test('a corrupt config degrades to defaults', () => {
  mkdirSync(SANDBOX, { recursive: true });
  writeFileSync(join(SANDBOX, 'config.json'), '{ this is not json', 'utf-8');
  const c = readConfig();
  assert.deepEqual(c.repos, {});
});

process.on('exit', () => rmSync(SANDBOX, { recursive: true, force: true }));
