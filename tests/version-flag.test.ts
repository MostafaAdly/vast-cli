import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VERSION } from '../src/version.js';

/** Runs the CLI in a sandboxed home with a fresh update cache (no network check). */
function vast(...args: string[]): { status: number | null; out: string } {
  const home = mkdtempSync(join(tmpdir(), 'vast-ver-'));
  try {
    writeFileSync(join(home, 'update-check.json'), JSON.stringify({ checkedAt: Date.now(), latest: VERSION }));
    const r = spawnSync(process.execPath, ['--import', 'tsx', 'src/cli-entry.ts', ...args], {
      encoding: 'utf-8',
      env: { ...process.env, VAST_CLI_HOME: home, HOME: home },
    });
    return { status: r.status, out: `${r.stdout}${r.stderr}`.trim() };
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

test('vast --version and vast -V print the version', () => {
  for (const flag of ['--version', '-V', '-v']) {
    const r = vast(flag);
    assert.equal(r.status, 0, flag);
    assert.equal(r.out, VERSION, flag);
  }
});

// The root's --version used to be parsed anywhere on the line, so
// `vast bar install --version 2.9.0` printed the version and installed nothing.
test("a subcommand's own --version reaches the subcommand", () => {
  const r = vast('bar', 'install', '--version', '9.9.9-dev');
  assert.equal(r.status, 1);
  assert.notEqual(r.out, VERSION);
  // A dev version is refused on macOS; elsewhere the platform is.
  assert.match(r.out, /development build|Vast Bar is a macOS app\./);
});
