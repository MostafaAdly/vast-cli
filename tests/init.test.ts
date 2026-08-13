import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';

// Sandbox BEFORE anything reads it, so a failing test cannot touch the real
// config. `vastHome()` reads the variable per call, so this covers the imports.
const SANDBOX = mkdtempSync(join(tmpdir(), 'vast-init-'));
process.env.VAST_CLI_HOME = SANDBOX;

import { mergeRepos, registerInitCommand } from '../src/commands/init.js';
import { readConfig, writeConfig } from '../src/config/workspace.js';
import { clearDiscoveryCache } from '../src/utils/discover.js';

function makeRepo(parent: string, name: string, origin: string): string {
  const dir = join(parent, name);
  mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['remote', 'add', 'origin', origin], { cwd: dir, stdio: 'pipe' });
  return dir;
}

// The data-loss sequence this guards: `vast init`, then
// `vast clone --team backend --into ~/side`, then `vast init` again. The second
// init only sweeps its search roots, and replacing the map wholesale wiped every
// repo living outside them.
test('keeps a known repo the scan did not reach', () => {
  const root = mkdtempSync(join(tmpdir(), 'vast-merge-a-'));
  try {
    const side = makeRepo(root, 'side-checkout', 'https://github.com/vast-menu/vastpay-backend');
    const merged = mergeRepos(
      { 'VastPay-BackEnd': side },
      { VastPayPwa: '/scanned/VastPayPwa' },
    );
    assert.deepEqual(merged, {
      VastPayPwa: '/scanned/VastPayPwa',
      'VastPay-BackEnd': side,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a freshly discovered path wins over the remembered one', () => {
  const root = mkdtempSync(join(tmpdir(), 'vast-merge-b-'));
  try {
    const old = makeRepo(root, 'old', 'https://github.com/vast-menu/vastpaypwa');
    const merged = mergeRepos({ VastPayPwa: old }, { VastPayPwa: '/scanned/elsewhere' });
    assert.equal(merged.VastPayPwa, '/scanned/elsewhere');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// Merging must not resurrect junk: survival is conditional on the path still
// being there and still being that repo.
test('drops a remembered path that no longer exists', () => {
  assert.deepEqual(mergeRepos({ VastPayPwa: '/gone/missing' }, {}), {});
});

test('drops a remembered path that is now a different repo', () => {
  const root = mkdtempSync(join(tmpdir(), 'vast-merge-c-'));
  try {
    const repurposed = makeRepo(root, 'repurposed', 'https://github.com/vast-menu/vastmenupwa');
    assert.deepEqual(mergeRepos({ VastPayPwa: repurposed }, {}), {});
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an empty scan still preserves what is verifiably there', () => {
  const root = mkdtempSync(join(tmpdir(), 'vast-merge-d-'));
  try {
    const dir = makeRepo(root, 'kept', 'https://github.com/vast-menu/vastpaypwa');
    assert.deepEqual(mergeRepos({ VastPayPwa: dir }, {}), { VastPayPwa: dir });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an empty config is just the scan', () => {
  assert.deepEqual(mergeRepos({}, { VastPayPwa: '/scanned/VastPayPwa' }), {
    VastPayPwa: '/scanned/VastPayPwa',
  });
});

/** Run `vast init` against the sandboxed config, without its console noise. */
/**
 * Runs `vast init` against an empty HOME.
 *
 * Every scan now includes the default roots under $HOME, and these fixtures use
 * real Vast origins — so on a machine that actually has those repos checked out,
 * the real copies would join the candidate list and win. Pointing HOME at an
 * empty directory keeps the test about the fixtures instead of about whatever
 * the developer happens to have cloned.
 */
async function runInit(): Promise<void> {
  const program = new Command();
  program.exitOverride();
  registerInitCommand(program);

  const realHome = process.env.HOME;
  const emptyHome = mkdtempSync(join(tmpdir(), 'vast-init-home-'));
  process.env.HOME = emptyHome;

  const spoken = console.log;
  console.log = () => {};
  try {
    await program.parseAsync(['init'], { from: 'user' });
  } finally {
    console.log = spoken;
    if (realHome === undefined) delete process.env.HOME;
    else process.env.HOME = realHome;
    rmSync(emptyHome, { recursive: true, force: true });
  }
}

// End to end, because the merge is only worth anything if init actually calls
// it: `vast init` -> `vast clone --team backend --into ~/side` -> `vast init`
// used to drop every repo under ~/side on that second run.
test('init keeps repos cloned outside the search roots', async () => {
  const known = mkdtempSync(join(tmpdir(), 'vast-init-known-'));
  const side = mkdtempSync(join(tmpdir(), 'vast-init-side-'));
  try {
    const scanned = makeRepo(known, 'vastpay-pwa', 'https://github.com/vast-menu/vastpaypwa');
    // What `vast clone --into <side>` leaves behind: the repo, plus a config
    // entry and a search root recording where it went.
    const cloned = makeRepo(side, 'vastpay-api', 'https://github.com/vast-menu/vastpay-backend');
    writeConfig({ repos: { 'VastPay-BackEnd': cloned }, searchRoots: [known, side] });

    clearDiscoveryCache();
    await runInit();

    const after = readConfig();
    assert.equal(after.repos.VastPayPwa, scanned, 'the scanned repo must be recorded');
    assert.equal(after.repos['VastPay-BackEnd'], cloned, 'the side checkout must survive init');
    assert.ok(after.searchRoots.includes(side), 'the side root must stay searchable');
  } finally {
    rmSync(known, { recursive: true, force: true });
    rmSync(side, { recursive: true, force: true });
  }
});

// The narrow-scan case: the side root is not even swept, so only the merge can
// save the entry.
test('init keeps a known repo when the scan cannot reach it', async () => {
  const known = mkdtempSync(join(tmpdir(), 'vast-init-known2-'));
  const side = mkdtempSync(join(tmpdir(), 'vast-init-side2-'));
  try {
    makeRepo(known, 'vastpay-pwa', 'https://github.com/vast-menu/vastpaypwa');
    const cloned = makeRepo(side, 'vastpay-api', 'https://github.com/vast-menu/vastpay-backend');
    // searchRoots deliberately omits `side` — the scan is blind to it.
    writeConfig({ repos: { 'VastPay-BackEnd': cloned }, searchRoots: [known] });

    clearDiscoveryCache();
    await runInit();

    const after = readConfig();
    assert.equal(after.repos['VastPay-BackEnd'], cloned, 'an unscanned checkout must survive');
    assert.ok(after.searchRoots.includes(side), 'its parent must become a search root');
  } finally {
    rmSync(known, { recursive: true, force: true });
    rmSync(side, { recursive: true, force: true });
  }
});

// Stale entries must still go, or the merge would just be a leak.
test('init still drops a remembered repo that is gone from disk', async () => {
  const known = mkdtempSync(join(tmpdir(), 'vast-init-known3-'));
  try {
    makeRepo(known, 'vastpay-pwa', 'https://github.com/vast-menu/vastpaypwa');
    writeConfig({ repos: { 'VastPay-BackEnd': '/gone/missing' }, searchRoots: [known] });

    clearDiscoveryCache();
    await runInit();

    assert.equal('VastPay-BackEnd' in readConfig().repos, false, 'a dead entry must not survive');
  } finally {
    rmSync(known, { recursive: true, force: true });
  }
});

process.on('exit', () => rmSync(SANDBOX, { recursive: true, force: true }));
