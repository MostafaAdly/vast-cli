import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.VAST_CLI_HOME = mkdtempSync(join(tmpdir(), 'vast-upg-'));

const { updateBarAfterUpgrade } = await import('../src/commands/upgrade.js');

test('after the CLI is upgraded, the new CLI updates an installed Vast Bar', () => {
  const runs: Array<[string, string[]]> = [];
  updateBarAfterUpgrade({ platform: 'darwin', home: '/h/.vast-cli', run: (f, a) => void runs.push([f, a]), warn: () => {} });
  assert.deepEqual(runs, [[process.execPath, ['/h/.vast-cli/vast.mjs', 'bar', 'install', '--if-installed']]]);
});

test('a failed app update is a warning, never a failed upgrade', () => {
  const warnings: string[] = [];
  assert.doesNotThrow(() =>
    updateBarAfterUpgrade({
      platform: 'darwin',
      home: '/h',
      run: () => {
        throw new Error('curl: (6) Could not resolve host');
      },
      warn: (m) => void warnings.push(m),
    }),
  );
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Vast Bar was not updated/);
  assert.match(warnings[0], /vast bar install/);
});

test('nothing runs outside macOS', () => {
  let ran = false;
  updateBarAfterUpgrade({ platform: 'linux', home: '/h', run: () => void (ran = true), warn: () => {} });
  assert.equal(ran, false);
});
