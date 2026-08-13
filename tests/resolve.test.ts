import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SANDBOX = mkdtempSync(join(tmpdir(), 'vast-res-'));
process.env.VAST_CLI_HOME = SANDBOX;

const { writeConfig, resolveRepoDir } = await import('../src/config/workspace.js');

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
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('re-discovers when the cached path is now a different repo', () => {
  const root = mkdtempSync(join(tmpdir(), 'vast-res-c-'));
  try {
    const wrong = makeRepo(root, 'wrong', 'https://github.com/vast-menu/vastmenupwa');
    const right = makeRepo(root, 'right', 'https://github.com/vast-menu/vastpaypwa');
    writeConfig({ repos: { VastPayPwa: wrong }, searchRoots: [root] });
    assert.equal(resolveRepoDir('VastPayPwa'), right);
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

process.on('exit', () => rmSync(SANDBOX, { recursive: true, force: true }));
