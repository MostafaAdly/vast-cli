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

/** A Mac where nothing real happens: every step is recorded in `calls`. */
class FakeMac implements Deps {
  platform: NodeJS.Platform = 'darwin';
  home = '/Users/eng';
  env: Record<string, string | undefined> = {};
  files = new Set<string>();
  calls: string[] = [];
  running = false;
  applicationsWritable = true;
  downloadResult: 'ok' | 'not-found' = 'ok';
  bundle: { id: string | null; version: string | null } = { id: BAR_BUNDLE_ID, version: '2.9.0' };
  signatureOk = true;
  unzipsApp = true;

  exists = (p: string) => this.files.has(p);
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
  plist = (_app: string) => this.bundle;
  verifySignature = async (_app: string) => {
    this.calls.push('verify');
    return this.signatureOk;
  };
  isRunning = async () => this.running;
  quit = async () => {
    this.calls.push('quit');
    this.running = false;
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
    `move /tmp/vb/unpacked/${BAR_APP} -> ${SYSTEM}`,
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
    'quit',
    `move ${USER} -> /tmp/vb/previous.app`,
    `move /tmp/vb/unpacked/${BAR_APP} -> ${USER}`,
    'remove /tmp/vb/previous.app',
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

test('a failed swap puts the old app back and reopens it if it was running', async () => {
  const mac = new FakeMac();
  mac.files.add(SYSTEM);
  mac.running = true;
  // Moving the new app INTO /Applications fails once; the restore (also into
  // /Applications) must then succeed.
  const move = mac.move;
  let failed = false;
  mac.move = (from, to) => {
    if (to === SYSTEM && !failed) {
      failed = true;
      throw new Error('EACCES: permission denied');
    }
    move(from, to);
  };
  await assert.rejects(installBar({ cliVersion: '2.9.0' }, mac), /Could not install into \/Applications/);
  assert.ok(mac.files.has(SYSTEM), 'the old app is back');
  assert.ok(mac.calls.includes(`move /tmp/vb/previous.app -> ${SYSTEM}`));
  assert.ok(mac.calls.includes(`open ${SYSTEM}`), 'reopened because it was running');
});

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
