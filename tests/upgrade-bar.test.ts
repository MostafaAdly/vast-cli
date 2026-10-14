import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.VAST_CLI_HOME = mkdtempSync(join(tmpdir(), 'vast-upg-'));

const { updateBarAfterUpgrade } = await import('../src/commands/upgrade.js');
const { BAR_DOWNLOAD_MAX_SECONDS } = await import('../src/utils/vast-bar.js');

const SYSTEM_APP = '/Applications/Vast Bar.app';
const USER_APP = join(homedir(), 'Applications', 'Vast Bar.app');
/** Only the app path given exists: nothing on this machine is looked at. */
const only = (path: string) => (p: string) => p === path;

test('after the CLI is upgraded, the new CLI updates an installed Vast Bar', () => {
  for (const app of [SYSTEM_APP, USER_APP]) {
    const runs: Array<[string, string[]]> = [];
    updateBarAfterUpgrade({
      platform: 'darwin',
      home: '/h/.vast-cli',
      exists: only(app),
      run: (f, a) => void runs.push([f, a]),
      warn: () => {},
    });
    assert.deepEqual(runs, [[process.execPath, ['/h/.vast-cli/vast.mjs', 'bar', 'install', '--if-installed']]], app);
  }
});

test('no app installed: the step is skipped, so a pre-2.9.0 CLI never warns about it', () => {
  let ran = false;
  const warnings: string[] = [];
  updateBarAfterUpgrade({
    platform: 'darwin',
    home: '/h',
    exists: () => false,
    run: () => {
      ran = true;
      throw new Error("error: unknown command 'bar'");
    },
    warn: (m) => void warnings.push(m),
  });
  assert.equal(ran, false);
  assert.deepEqual(warnings, []);
});

test('a failed app update is a warning, never a failed upgrade', () => {
  const warnings: string[] = [];
  assert.doesNotThrow(() =>
    updateBarAfterUpgrade({
      platform: 'darwin',
      home: '/h',
      exists: only(SYSTEM_APP),
      run: () => {
        throw new Error('curl: (6) Could not resolve host');
      },
      warn: (m) => void warnings.push(m),
    }),
  );
  assert.deepEqual(warnings, [
    'Vast Bar update did not finish: curl: (6) Could not resolve host\n' +
      '  The CLI upgrade is done. Run vast bar install to retry.',
  ]);
});

test('the app step outlasts the download it waits on', () => {
  const timeouts: number[] = [];
  updateBarAfterUpgrade({
    platform: 'darwin',
    home: '/h',
    exists: only(SYSTEM_APP),
    run: (_f, _a, timeoutMs) => void timeouts.push(timeoutMs),
    warn: () => {},
  });
  assert.deepEqual(timeouts, [900_000]);
  assert.ok(timeouts[0] > BAR_DOWNLOAD_MAX_SECONDS * 1000);
});

test('nothing runs outside macOS', () => {
  let ran = false;
  updateBarAfterUpgrade({ platform: 'linux', home: '/h', exists: () => true, run: () => void (ran = true), warn: () => {} });
  assert.equal(ran, false);
});
