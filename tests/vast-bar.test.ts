import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.VAST_CLI_HOME = mkdtempSync(join(tmpdir(), 'vast-bar-'));

const { BAR_APP, BAR_BUNDLE_ID, BarError, barStatusLine, barUrl, installBar, uninstallBar } = await import(
  '../src/utils/vast-bar.js'
);
type Deps = import('../src/utils/vast-bar.js').BarDeps;

const SYSTEM = `/Applications/${BAR_APP}`;
const USER = `/Users/eng/Applications/${BAR_APP}`;
const URL_290 = 'https://github.com/MostafaAdly/vast-cli/releases/download/v2.9.0/VastBar.zip';
const FRESH = `/tmp/vb/unpacked/${BAR_APP}`;
const STAGED = '/Applications/.Vast Bar.new.app';
const PREVIOUS = '/Applications/.Vast Bar.previous.app';
const USER_STAGED = '/Users/eng/Applications/.Vast Bar.new.app';
const USER_PREVIOUS = '/Users/eng/Applications/.Vast Bar.previous.app';

/** A Mac where nothing real happens: every step is recorded in `calls`. */
class FakeMac implements Deps {
  platform: NodeJS.Platform = 'darwin';
  home = '/Users/eng';
  env: Record<string, string | undefined> = {};
  files = new Set<string>();
  calls: string[] = [];
  running = false;
  /** Whether quit() gets the app to go. */
  quitWorks = true;
  applicationsWritable = true;
  downloadResult: 'ok' | 'not-found' = 'ok';
  /** The downloaded app's Info.plist. */
  bundle: { id: string | null; version: string | null } = { id: BAR_BUNDLE_ID, version: '2.9.0' };
  /** The installed app's Info.plist (anything outside the temp dir). */
  installedBundle: { id: string | null; version: string | null } = { id: BAR_BUNDLE_ID, version: '2.8.0' };
  signatureOk = true;
  unzipsApp = true;

  /** A directory exists when something is inside it. */
  exists = (p: string) => this.files.has(p) || [...this.files].some((f) => f.startsWith(`${p}/`));
  writable = (dir: string) => (dir === '/Applications' ? this.applicationsWritable : true);
  makeTempDir = () => '/tmp/vb';
  mkdirp = (dir: string) => void this.calls.push(`mkdir ${dir}`);
  download = async (url: string, _to: string) => {
    this.calls.push(`download ${url}`);
    return this.downloadResult;
  };
  unzip = async (_zip: string, into: string) => {
    this.calls.push('unzip');
    if (this.unzipsApp) this.files.add(join(into, BAR_APP));
  };
  plist = (app: string) => (app.startsWith('/tmp/vb/') ? this.bundle : this.installedBundle);
  verifySignature = async (_app: string) => {
    this.calls.push('verify');
    return this.signatureOk;
  };
  isRunning = async () => this.running;
  quit = async () => {
    this.calls.push('quit');
    if (this.quitWorks) this.running = false;
    return this.quitWorks;
  };
  move = (from: string, to: string) => {
    this.calls.push(`move ${from} -> ${to}`);
    this.files.delete(from);
    this.files.add(to);
  };
  remove = (p: string) => {
    this.calls.push(`remove ${p}`);
    this.files.delete(p);
  };
  clearQuarantine = async (app: string) => void this.calls.push(`clear ${app}`);
  open = async (app: string) => void this.calls.push(`open ${app}`);
}

test('every subcommand refuses outside macOS', async () => {
  const mac = new FakeMac();
  mac.platform = 'linux';
  assert.throws(() => barStatusLine(mac, '2.9.0'), { message: 'Vast Bar is a macOS app.' });
  await assert.rejects(installBar({ cliVersion: '2.9.0' }, mac), { message: 'Vast Bar is a macOS app.' });
  await assert.rejects(uninstallBar({ purge: false }, mac), { message: 'Vast Bar is a macOS app.' });
});

test('the release URL is per version, and VAST_BAR_URL overrides it', () => {
  assert.equal(barUrl('2.9.0', {}), URL_290);
  assert.equal(barUrl('2.9.0', { VAST_BAR_URL: 'file:///tmp/VastBar.zip' }), 'file:///tmp/VastBar.zip');
});

test('status: not installed, current, older than the CLI', () => {
  const mac = new FakeMac();
  assert.equal(barStatusLine(mac, '2.9.0'), 'Vast Bar is not installed — run vast bar install');
  mac.files.add(SYSTEM);
  mac.installedBundle.version = '2.9.0';
  assert.equal(barStatusLine(mac, '2.9.0'), 'Vast Bar 2.9.0 installed in /Applications · CLI 2.9.0');
  assert.equal(
    barStatusLine(mac, '2.10.0'),
    'Vast Bar 2.9.0 is older than the CLI (2.10.0) — run vast bar install',
  );
});

test('a fresh install downloads, verifies, moves into /Applications, clears quarantine and opens', async () => {
  const mac = new FakeMac();
  const result = await installBar({ cliVersion: '2.9.0' }, mac);
  assert.deepEqual(result, { path: SYSTEM, version: '2.9.0', opened: true });
  assert.deepEqual(mac.calls, [
    `download ${URL_290}`,
    'mkdir /tmp/vb/unpacked',
    'unzip',
    'verify',
    `move ${FRESH} -> ${STAGED}`,
    `move ${STAGED} -> ${SYSTEM}`,
    `clear ${SYSTEM}`,
    `open ${SYSTEM}`,
    'remove /tmp/vb',
  ]);
});

test('an existing install is replaced where it is, quitting it first', async () => {
  const mac = new FakeMac();
  mac.files.add(USER);
  mac.running = true;
  const result = await installBar({ cliVersion: '2.9.0' }, mac);
  assert.equal(result?.path, USER);
  assert.deepEqual(mac.calls.slice(4), [
    `move ${FRESH} -> ${USER_STAGED}`,
    'quit',
    `move ${USER} -> ${USER_PREVIOUS}`,
    `move ${USER_STAGED} -> ${USER}`,
    `remove ${USER_PREVIOUS}`,
    `clear ${USER}`,
    `open ${USER}`,
    'remove /tmp/vb',
  ]);
});

test('a user who cannot write /Applications gets ~/Applications, no sudo', async () => {
  const mac = new FakeMac();
  mac.applicationsWritable = false;
  const result = await installBar({ cliVersion: '2.9.0' }, mac);
  assert.equal(result?.path, USER);
  assert.ok(mac.calls.includes('mkdir /Users/eng/Applications'));
});

test('a development CLI is refused before any download', async () => {
  const mac = new FakeMac();
  await assert.rejects(installBar({ cliVersion: '2.9.0-dev' }, mac), (e: Error) => {
    assert.ok(e instanceof BarError);
    assert.match(e.message, /development build/);
    assert.match(e.message, /apps\/menubar\/build\.sh/);
    return true;
  });
  assert.deepEqual(mac.calls, []);
});

test('--version picks the release, with or without a leading v', async () => {
  const mac = new FakeMac();
  mac.bundle.version = '2.9.0';
  await installBar({ cliVersion: '2.10.0', version: 'v2.9.0' }, mac);
  assert.equal(mac.calls[0], `download ${URL_290}`);
});

test('a release without the app says to upgrade first', async () => {
  const mac = new FakeMac();
  mac.downloadResult = 'not-found';
  await assert.rejects(installBar({ cliVersion: '2.9.0' }, mac), {
    message: 'Release v2.9.0 has no Vast Bar (it shipped from 2.9.0). Run vast upgrade first.',
  });
});

for (const [name, setup, message] of [
  ['no app in the zip', (m: FakeMac) => (m.unzipsApp = false), /has no Vast Bar\.app/],
  ['a different bundle', (m: FakeMac) => (m.bundle = { id: 'com.example.other', version: '2.9.0' }), /not Vast Bar/],
  ['the wrong version', (m: FakeMac) => (m.bundle = { id: BAR_BUNDLE_ID, version: '2.8.0' }), /is 2\.8\.0, expected 2\.9\.0/],
  ['a broken signature', (m: FakeMac) => (m.signatureOk = false), /signature/],
] as const) {
  test(`${name} is refused and nothing installed is touched`, async () => {
    const mac = new FakeMac();
    mac.files.add(SYSTEM);
    mac.running = true;
    setup(mac);
    await assert.rejects(installBar({ cliVersion: '2.9.0' }, mac), message);
    assert.ok(mac.files.has(SYSTEM));
    assert.equal(mac.running, true, 'the running app was not quit');
    assert.ok(!mac.calls.some((c) => c.startsWith('move')));
    assert.equal(mac.calls.at(-1), 'remove /tmp/vb');
  });
}

/** Makes `mac.move` throw for the moves `fails` picks, recording them like real ones. */
function failMoves(mac: FakeMac, fails: (from: string, to: string) => boolean): void {
  const move = mac.move;
  mac.move = (from, to) => {
    if (fails(from, to)) {
      mac.calls.push(`move ${from} -> ${to} FAILED`);
      throw new Error('EACCES: permission denied');
    }
    move(from, to);
  };
}

test('an install folder you cannot write is refused before quitting or moving anything', async () => {
  const mac = new FakeMac();
  mac.files.add(SYSTEM);
  mac.running = true;
  mac.applicationsWritable = false;
  await assert.rejects(installBar({ cliVersion: '2.9.0' }, mac), (e: Error) => {
    assert.ok(e instanceof BarError);
    assert.equal(
      e.message,
      "/Applications is not writable for you, so Vast Bar can't be installed or updated there without admin rights. " +
        'Remove it with admin rights, or install to ~/Applications by removing the copy in /Applications first.',
    );
    return true;
  });
  assert.equal(mac.running, true, 'not quit');
  assert.ok(!mac.calls.includes('quit'));
  assert.ok(!mac.calls.some((c) => c.startsWith('move')));
  assert.ok(mac.files.has(SYSTEM));
});

test('a staging failure leaves the installed app untouched and running', async () => {
  const mac = new FakeMac();
  mac.files.add(SYSTEM);
  mac.running = true;
  failMoves(mac, (_from, to) => to === STAGED);
  await assert.rejects(installBar({ cliVersion: '2.9.0' }, mac), (e: Error) => {
    assert.ok(e instanceof BarError);
    assert.match(e.message, /^Could not stage Vast Bar in \/Applications: EACCES/);
    return true;
  });
  assert.ok(mac.files.has(SYSTEM));
  assert.equal(mac.running, true, 'not quit');
  assert.ok(!mac.calls.includes('quit'));
  assert.ok(mac.calls.includes(`remove ${STAGED}`), 'the partial stage is cleaned up');
  assert.ok(!mac.calls.some((c) => c.includes(`${SYSTEM} ->`) || c === `remove ${SYSTEM}`));
});

test('a leftover staged copy is removed before staging', async () => {
  const mac = new FakeMac();
  mac.files.add(STAGED);
  await installBar({ cliVersion: '2.9.0' }, mac);
  const removed = mac.calls.indexOf(`remove ${STAGED}`);
  assert.ok(removed >= 0);
  assert.ok(removed < mac.calls.indexOf(`move ${FRESH} -> ${STAGED}`));
});

test('a leftover previous copy is cleared before the installed app steps aside', async () => {
  const mac = new FakeMac();
  mac.files.add(SYSTEM);
  mac.files.add(PREVIOUS);
  await installBar({ cliVersion: '2.9.0' }, mac);
  const removed = mac.calls.indexOf(`remove ${PREVIOUS}`);
  assert.ok(removed >= 0);
  assert.ok(removed < mac.calls.indexOf(`move ${SYSTEM} -> ${PREVIOUS}`));
  assert.ok(mac.files.has(SYSTEM));
});

test('a failed final rename restores the previous app and reopens it', async () => {
  const mac = new FakeMac();
  mac.files.add(SYSTEM);
  mac.running = true;
  failMoves(mac, (from, to) => from === STAGED && to === SYSTEM);
  await assert.rejects(installBar({ cliVersion: '2.9.0' }, mac), (e: Error) => {
    assert.ok(e instanceof BarError);
    assert.match(e.message, /^Could not install into \/Applications: EACCES/);
    return true;
  });
  assert.deepEqual(mac.calls.slice(4), [
    `move ${FRESH} -> ${STAGED}`,
    'quit',
    `move ${SYSTEM} -> ${PREVIOUS}`,
    `move ${STAGED} -> ${SYSTEM} FAILED`,
    `remove ${SYSTEM}`,
    `move ${PREVIOUS} -> ${SYSTEM}`,
    `open ${SYSTEM}`,
    `remove ${STAGED}`,
    'remove /tmp/vb',
  ]);
  assert.ok(mac.files.has(SYSTEM), 'the old app is back');
  assert.ok(!mac.files.has(PREVIOUS));
});

test('a failed restore keeps the previous app and names it', async () => {
  const mac = new FakeMac();
  mac.files.add(SYSTEM);
  mac.running = true;
  failMoves(mac, (from, to) => to === SYSTEM && (from === STAGED || from === PREVIOUS));
  await assert.rejects(installBar({ cliVersion: '2.9.0' }, mac), (e: Error) => {
    assert.ok(e instanceof BarError);
    assert.match(e.message, /^Could not install into \/Applications: EACCES/);
    assert.ok(e.message.includes(`Your previous Vast Bar is kept at ${PREVIOUS}`), e.message);
    return true;
  });
  assert.ok(mac.files.has(PREVIOUS), 'the only good copy survives');
  assert.ok(!mac.calls.includes(`remove ${PREVIOUS}`));
  // It was running: reopen it where it is kept rather than leave it closed.
  assert.ok(mac.calls.includes(`open ${PREVIOUS}`), mac.calls.join('\n'));
});

test('a failed move-aside reopens the app that was running', async () => {
  const mac = new FakeMac();
  mac.files.add(SYSTEM);
  mac.running = true;
  failMoves(mac, (from) => from === SYSTEM);
  await assert.rejects(installBar({ cliVersion: '2.9.0' }, mac), { message: /^Could not install into \/Applications: EACCES/ });
  assert.ok(mac.files.has(SYSTEM));
  assert.ok(mac.calls.includes(`open ${SYSTEM}`));
  assert.ok(!mac.calls.includes(`remove ${SYSTEM}`));
  assert.ok(!mac.files.has(STAGED), 'the staged copy is cleaned up');
});

test('an app that will not quit is never swapped', async () => {
  const mac = new FakeMac();
  mac.files.add(SYSTEM);
  mac.running = true;
  mac.quitWorks = false;
  await assert.rejects(installBar({ cliVersion: '2.9.0' }, mac), (e: Error) => {
    assert.ok(e instanceof BarError);
    assert.equal(e.message, 'Vast Bar did not quit. Quit it from its … menu and run the command again.');
    return true;
  });
  assert.ok(mac.files.has(SYSTEM));
  assert.ok(!mac.calls.some((c) => c.includes(`${SYSTEM} ->`) || c.endsWith(`-> ${SYSTEM}`) || c === `remove ${SYSTEM}`));
  assert.ok(!mac.files.has(STAGED), 'the staged copy is cleaned up');
});

for (const version of ['latest', '2.9', 'v2.9.0.1', '2.9.0/../../x']) {
  test(`--version ${version} is refused before any download`, async () => {
    const mac = new FakeMac();
    await assert.rejects(installBar({ cliVersion: '2.9.0', version }, mac), (e: Error) => {
      assert.ok(e instanceof BarError);
      assert.equal(e.message, `--version must look like 2.9.0 (got ${version.replace(/^v/, '')}).`);
      return true;
    });
    assert.deepEqual(mac.calls, []);
  });
}

test('--if-installed does nothing when the app is not installed', async () => {
  const mac = new FakeMac();
  assert.equal(await installBar({ cliVersion: '2.9.0', ifInstalled: true }, mac), null);
  assert.deepEqual(mac.calls, []);
});

test('--if-installed updates an installed app but reopens it only if it was running', async () => {
  const quiet = new FakeMac();
  quiet.files.add(SYSTEM);
  const r1 = await installBar({ cliVersion: '2.9.0', ifInstalled: true }, quiet);
  assert.equal(r1?.opened, false);
  assert.ok(!quiet.calls.some((c) => c.startsWith('open')));

  const busy = new FakeMac();
  busy.files.add(SYSTEM);
  busy.running = true;
  const r2 = await installBar({ cliVersion: '2.9.0', ifInstalled: true }, busy);
  assert.equal(r2?.opened, true);
});

test('uninstall quits and removes the app; --purge also removes its run logs', async () => {
  const mac = new FakeMac();
  const support = '/Users/eng/Library/Application Support/Vast Bar';
  mac.files.add(SYSTEM);
  mac.files.add(support);
  mac.running = true;
  assert.deepEqual(await uninstallBar({ purge: false }, mac), [SYSTEM]);
  assert.deepEqual(mac.calls, ['quit', `remove ${SYSTEM}`]);
  assert.ok(mac.files.has(support));

  mac.files.add(SYSTEM);
  assert.deepEqual(await uninstallBar({ purge: true }, mac), [SYSTEM, support]);
  assert.deepEqual(await uninstallBar({ purge: true }, new FakeMac()), []);
});

test('an app that installs but will not open is reported plainly, not as a crash', async () => {
  const mac = new FakeMac();
  mac.open = async () => {
    throw new Error('Command failed: open /Applications/Vast Bar.app (-600)');
  };
  await assert.rejects(installBar({ cliVersion: '2.9.0' }, mac), (e: Error) => {
    assert.ok(e instanceof BarError);
    assert.match(e.message, /Vast Bar 2\.9\.0 is installed in \/Applications, but macOS would not open it/);
    return true;
  });
  assert.ok(mac.files.has(SYSTEM), 'the new app stays installed');
});

test('a stale staged copy that cannot be removed is refused plainly, before anything is quit', async () => {
  const mac = new FakeMac();
  mac.files.add(SYSTEM);
  mac.files.add(STAGED);
  mac.running = true;
  failRemoves(mac, (p) => p === STAGED);
  await assert.rejects(installBar({ cliVersion: '2.9.0' }, mac), (e: Error) => {
    assert.ok(e instanceof BarError);
    assert.match(e.message, /An earlier install left \/Applications\/\.Vast Bar\.new\.app and it can't be removed/);
    return true;
  });
  assert.ok(!mac.calls.includes('quit'));
  assert.ok(mac.files.has(SYSTEM));
});

test('a failed stage whose cleanup also fails still reports the stage error', async () => {
  const mac = new FakeMac();
  mac.files.add(SYSTEM);
  failMoves(mac, (_from, to) => to === STAGED);
  failRemoves(mac, (p) => p === STAGED);
  await assert.rejects(installBar({ cliVersion: '2.9.0' }, mac), /Could not stage Vast Bar in \/Applications: EACCES/);
});

test('uninstall also removes the hidden leftovers of an earlier install', async () => {
  const mac = new FakeMac();
  for (const p of [SYSTEM, PREVIOUS, USER_STAGED]) mac.files.add(p);
  assert.deepEqual(await uninstallBar({ purge: false }, mac), [SYSTEM, PREVIOUS, USER_STAGED]);
  assert.equal(barStatusLine(mac, '2.9.0'), 'Vast Bar is not installed — run vast bar install');
});

test('uninstall removes a lone leftover copy', async () => {
  const mac = new FakeMac();
  mac.files.add(USER_PREVIOUS);
  assert.deepEqual(await uninstallBar({ purge: false }, mac), [USER_PREVIOUS]);
});

test('uninstall refuses to remove an app that will not quit', async () => {
  const mac = new FakeMac();
  mac.files.add(SYSTEM);
  mac.running = true;
  mac.quitWorks = false;
  await assert.rejects(uninstallBar({ purge: true }, mac), {
    message: 'Vast Bar did not quit. Quit it from its … menu and run the command again.',
  });
  assert.deepEqual(mac.calls, ['quit']);
  assert.ok(mac.files.has(SYSTEM));
});

/** Makes `mac.remove` throw for the paths `fails` picks, leaving them in place. */
function failRemoves(mac: FakeMac, fails: (path: string) => boolean): void {
  const remove = mac.remove;
  mac.remove = (p) => {
    if (fails(p)) {
      mac.calls.push(`remove ${p} FAILED`);
      throw new Error('EACCES: permission denied');
    }
    remove(p);
  };
}

test('a leftover previous copy that cannot be removed is refused before anything is quit or moved', async () => {
  const mac = new FakeMac();
  mac.files.add(SYSTEM);
  mac.files.add(PREVIOUS);
  mac.running = true;
  failRemoves(mac, (p) => p === PREVIOUS);
  await assert.rejects(installBar({ cliVersion: '2.9.0' }, mac), (e: Error) => {
    assert.ok(e instanceof BarError);
    assert.equal(
      e.message,
      `An earlier install left ${PREVIOUS} and it can't be removed (it may need admin rights). ` +
        'Remove it, then run vast bar install again.',
    );
    return true;
  });
  assert.equal(mac.running, true, 'not quit');
  assert.ok(!mac.calls.includes('quit'));
  assert.ok(!mac.calls.some((c) => c.startsWith('move')), mac.calls.join('\n'));
  assert.ok(!mac.calls.includes(`remove ${SYSTEM}`), 'the installed app is never removed');
  assert.ok(mac.files.has(SYSTEM));
  assert.ok(!mac.calls.some((c) => c.startsWith('open')));
});

test('a previous copy that cannot be removed after the swap is a warning: the new app is cleared and opened', async () => {
  const mac = new FakeMac();
  mac.files.add(SYSTEM);
  mac.running = true;
  // Removable until the swap moves the installed app there (say it was installed with sudo).
  let swapped = false;
  const move = mac.move;
  mac.move = (from, to) => {
    move(from, to);
    if (to === PREVIOUS) swapped = true;
  };
  failRemoves(mac, (p) => p === PREVIOUS && swapped);
  const result = await installBar({ cliVersion: '2.9.0' }, mac);
  assert.deepEqual(result, {
    path: SYSTEM,
    version: '2.9.0',
    opened: true,
    warning:
      `The previous Vast Bar is left at ${PREVIOUS} and could not be removed (it may need admin rights). ` +
      'Remove it, or the next update will refuse.',
  });
  assert.deepEqual(mac.calls.slice(4), [
    `move ${FRESH} -> ${STAGED}`,
    'quit',
    `move ${SYSTEM} -> ${PREVIOUS}`,
    `move ${STAGED} -> ${SYSTEM}`,
    `remove ${PREVIOUS} FAILED`,
    `clear ${SYSTEM}`,
    `open ${SYSTEM}`,
    'remove /tmp/vb',
  ]);
});

test('the restore only undoes a move-aside this run made, never a previous copy it found', async () => {
  // A leftover previous copy that "removes" without going (a partial delete),
  // then the installed app cannot step aside: nothing may be restored over it.
  const mac = new FakeMac();
  mac.files.add(SYSTEM);
  mac.files.add(PREVIOUS);
  mac.running = true;
  const remove = mac.remove;
  mac.remove = (p) => (p === PREVIOUS ? void mac.calls.push(`remove ${p}`) : remove(p));
  failMoves(mac, (from) => from === SYSTEM);
  await assert.rejects(installBar({ cliVersion: '2.9.0' }, mac), { message: /^Could not install into \/Applications: EACCES/ });
  assert.ok(!mac.calls.includes(`remove ${SYSTEM}`), mac.calls.join('\n'));
  assert.ok(!mac.calls.includes(`move ${PREVIOUS} -> ${SYSTEM}`), mac.calls.join('\n'));
  assert.ok(mac.files.has(SYSTEM), 'the installed app is untouched');
  assert.ok(mac.calls.includes(`open ${SYSTEM}`), 'and reopened');
});

test('a failing temp-dir cleanup never replaces the real error', async () => {
  const mac = new FakeMac();
  mac.files.add(SYSTEM);
  mac.running = true;
  mac.quitWorks = false;
  failRemoves(mac, (p) => p === '/tmp/vb' || p === STAGED);
  await assert.rejects(installBar({ cliVersion: '2.9.0' }, mac), {
    message: 'Vast Bar did not quit. Quit it from its … menu and run the command again.',
  });
});

test('a failing temp-dir cleanup never fails a good install', async () => {
  const mac = new FakeMac();
  failRemoves(mac, (p) => p === '/tmp/vb');
  const result = await installBar({ cliVersion: '2.9.0' }, mac);
  assert.equal(result?.path, SYSTEM);
});

test('status: an interrupted install that left only the previous copy says where it is', () => {
  for (const previous of [PREVIOUS, USER_PREVIOUS]) {
    const mac = new FakeMac();
    mac.files.add(previous);
    assert.equal(
      barStatusLine(mac, '2.9.0'),
      `Vast Bar is not installed, but an interrupted install left it at ${previous} — ` +
        'rename it to "Vast Bar.app" or run vast bar install',
    );
  }
});

test('an install after an interrupted one goes back where the app was', async () => {
  const mac = new FakeMac();
  mac.files.add(USER_PREVIOUS);
  const result = await installBar({ cliVersion: '2.9.0' }, mac);
  assert.equal(result?.path, USER);
  assert.ok(mac.calls.includes(`move ${USER_STAGED} -> ${USER}`));
  assert.ok(!mac.files.has(USER_PREVIOUS), 'the leftover is cleared');
  assert.ok(!mac.files.has(SYSTEM));
});

// The lone leftover is the user's only copy: it is put back as the app before
// anything else, never deleted, so a failure later still leaves a working app.
test('a lone leftover is restored first, so a failed install still leaves the app', async () => {
  const mac = new FakeMac();
  mac.files.add(USER_PREVIOUS);
  failMoves(mac, (from, to) => from === USER_STAGED && to === USER);
  await assert.rejects(installBar({ cliVersion: '2.9.0' }, mac), BarError);
  assert.ok(mac.calls.includes(`move ${USER_PREVIOUS} -> ${USER}`), 'restored before the install');
  assert.ok(mac.files.has(USER), 'the old app is back in place');
});

test('a lone leftover that cannot be restored stops the install before anything changes', async () => {
  const mac = new FakeMac();
  mac.files.add(USER_PREVIOUS);
  failMoves(mac, (from, to) => from === USER_PREVIOUS && to === USER);
  await assert.rejects(installBar({ cliVersion: '2.9.0' }, mac), (e: Error) => {
    assert.ok(e instanceof BarError);
    assert.match(e.message, /left .*\.Vast Bar\.previous\.app.*rename it to "Vast Bar\.app"/);
    return true;
  });
  assert.ok(mac.files.has(USER_PREVIOUS), 'the only copy is never deleted');
  assert.ok(!mac.calls.includes('quit'));
});

test('--if-installed does nothing when the installed app is already this version', async () => {
  const mac = new FakeMac();
  mac.files.add(SYSTEM);
  mac.installedBundle.version = '2.9.0';
  mac.running = true;
  assert.equal(await installBar({ cliVersion: '2.9.0', ifInstalled: true }, mac), null);
  assert.deepEqual(mac.calls, []);
});

test('a plain install reinstalls even the same version: it was asked for', async () => {
  const mac = new FakeMac();
  mac.files.add(SYSTEM);
  mac.installedBundle.version = '2.9.0';
  const result = await installBar({ cliVersion: '2.9.0' }, mac);
  assert.equal(result?.opened, true);
  assert.equal(mac.calls[0], `download ${URL_290}`);
});
