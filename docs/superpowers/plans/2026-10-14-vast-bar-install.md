# vast bar install Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `vast bar install` puts the released Vast Bar app (matching the CLI's version) into Applications with no Xcode and no Gatekeeper prompt, and `vast upgrade` keeps it in step.

**Architecture:** CI builds a universal, ad-hoc-signed `Vast Bar.app` on macOS and attaches it as `VastBar.zip` to the same release as `vast.mjs`. A new `vast bar` command group downloads it with `curl` (no quarantine attribute), verifies it, swaps it into place and opens it; every file and process step goes through an injected `BarDeps`, so the whole flow is unit-tested. `vast upgrade` finishes by running the new CLI's `bar install --if-installed`. The app gains an "Open at login" menu item (`SMAppService`).

**Tech Stack:** TypeScript (strict, NodeNext ESM), Commander, node:test; bash; GitHub Actions (`macos-15`); Swift 6 / SwiftUI / ServiceManagement.

**Spec:** `docs/superpowers/specs/2026-10-14-vast-bar-install-design.md`

## Global Constraints

- The asset is named `VastBar.zip`, never renamed anywhere (workflow, CLI, docs) — like `vast.mjs`.
- Download URL: `https://github.com/MostafaAdly/vast-cli/releases/download/v<ver>/VastBar.zip`; `VAST_BAR_URL` overrides it (live checks only).
- The bundle is `Vast Bar.app`, identifier `com.vastgroup.vastbar`; its `CFBundleShortVersionString` equals the CLI version without `v`.
- macOS only: every `vast bar` subcommand on another platform exits 1 with exactly `Vast Bar is a macOS app.`
- Never `sudo`. Install target: the existing install's directory; else `/Applications` if writable; else `~/Applications` (created).
- No new runtime dependencies. Relative imports carry `.js`.
- Commit messages: conventional, no AI attribution (no `Co-Authored-By`, no "Generated with").
- Docs ship in the same PR: README, `skills/release/SKILL.md`, CLAUDE.md; every documented command/flag verified with `node bin/vast.js bar --help` (and `bar install --help`, `bar uninstall --help`).
- `dist/` is committed: run `npm run build` and commit `dist/` with source changes.
- Tests never touch the real `~/.vast-cli`, the real `/Applications`, or the network: `VAST_CLI_HOME` sandbox + injected deps.

## Review Focus

1. A download that succeeds but is not the app (an HTML error page, a truncated zip, a different bundle or version) — must be refused before anything installed is touched. Pinned in Task 2 (wrong id, wrong version, bad signature, missing bundle).
2. The swap failing halfway (permissions, disk) — the old app must be back in place and, if it was running, running again. Pinned in Task 2.
3. A developer's `2.9.0-dev` CLI or a release older than the app — a clear message, no download attempt for dev. Pinned in Task 2.
4. `vast upgrade` when the app update fails — the CLI upgrade still succeeds (exit 0) with a warning. Pinned in Task 4.
5. `/Applications` not writable for a non-admin user — install lands in `~/Applications` without prompting. Pinned in Task 2.

---

## File Structure

```
src/utils/vast-bar.ts            Task 2   pure install/status/uninstall logic over BarDeps
src/commands/bar.ts              Task 3   real BarDeps (curl, ditto, plutil, codesign, …) + Commander wiring
src/cli.ts                       Task 3   register the command
src/utils/help.ts                Task 3   root help row
src/commands/upgrade.ts          Task 4   updateBarAfterUpgrade
tests/vast-bar.test.ts           Task 2
tests/upgrade-bar.test.ts        Task 4
apps/menubar/build.sh            Task 1   version from package.json, --universal
apps/menubar/Sources/VastBar/LoginItem.swift   Task 5
apps/menubar/Sources/VastBar/PopoverView.swift Task 5   power button → "…" menu
.github/workflows/release.yml    Task 6   cli / app / publish jobs
README.md, skills/release/SKILL.md, CLAUDE.md, dist/   Task 7
```

Waves: Task 1, Task 2, Task 5 and Task 6 are independent (parallel); Task 3 after Task 2; Task 4 after Task 3; Task 7 last.

---

### Task 1: build.sh — version from package.json, universal builds

**Files:**
- Modify: `apps/menubar/build.sh` (whole file below)

**Interfaces:**
- Produces: `apps/menubar/build.sh [--no-install] [--universal]`; the bundle's `CFBundleShortVersionString` and `CFBundleVersion` = `package.json` version. Task 6 runs `apps/menubar/build.sh --no-install --universal`.

- [ ] **Step 1: Check today's behaviour (the "failing test")**

Run: `cd apps/menubar && ./build.sh --no-install && plutil -extract CFBundleShortVersionString raw "build/Vast Bar.app/Contents/Info.plist" && node -p "require('../../package.json').version"`
Expected: `0.1.0` then `2.8.1` — they differ.

- [ ] **Step 2: Replace `apps/menubar/build.sh` with:**

```bash
#!/bin/bash
# Builds Vast Bar.app (ad-hoc signed, no Dock icon) and installs it in /Applications.
#   ./build.sh                  build and install (native arch)
#   ./build.sh --no-install     build only
#   ./build.sh --universal      arm64 + x86_64 (the release build)
# The app's version is the CLI's (package.json), so app X.Y.Z pairs with CLI X.Y.Z.
set -euo pipefail
cd "$(dirname "$0")"

NO_INSTALL=0
UNIVERSAL=0
for arg in "$@"; do
  case "$arg" in
    --no-install) NO_INSTALL=1 ;;
    --universal) UNIVERSAL=1 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

VERSION="$(node -p "require('../../package.json').version")"
ARCHS=()
if [ "$UNIVERSAL" = 1 ]; then ARCHS=(--arch arm64 --arch x86_64); fi

# ${ARCHS[@]+...}: macOS's bash 3.2 treats an empty array as unbound under set -u.
swift build -c release --product VastBar ${ARCHS[@]+"${ARCHS[@]}"}
BIN="$(swift build -c release ${ARCHS[@]+"${ARCHS[@]}"} --show-bin-path)/VastBar"

APP="build/Vast Bar.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
cp "$BIN" "$APP/Contents/MacOS/VastBar"
mkdir -p "$APP/Contents/Resources"
cp Resources/AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>VastBar</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundleIdentifier</key><string>com.vastgroup.vastbar</string>
  <key>CFBundleName</key><string>Vast Bar</string>
  <key>CFBundleDisplayName</key><string>Vast Bar</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${VERSION}</string>
  <key>CFBundleVersion</key><string>${VERSION}</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSUIElement</key><true/>
  <key>NSAppleEventsUsageDescription</key><string>Vast Bar opens Terminal to run a vast command you asked for.</string>
</dict>
</plist>
PLIST
codesign --force --sign - "$APP"
echo "built $APP ($VERSION)"

if [ "$NO_INSTALL" = 0 ]; then
  osascript -e 'quit app "Vast Bar"' 2>/dev/null || true
  rm -rf "/Applications/Vast Bar.app"
  cp -R "$APP" /Applications/
  echo "installed /Applications/Vast Bar.app"
fi
```

- [ ] **Step 3: Verify both modes**

Run: `cd apps/menubar && ./build.sh --no-install && plutil -extract CFBundleShortVersionString raw "build/Vast Bar.app/Contents/Info.plist" && lipo -archs "build/Vast Bar.app/Contents/MacOS/VastBar"`
Expected: `built build/Vast Bar.app (2.8.1)`, `2.8.1`, `arm64`.

Run: `./build.sh --no-install --universal && lipo -archs "build/Vast Bar.app/Contents/MacOS/VastBar" && codesign --verify --deep --strict "build/Vast Bar.app" && echo SIGNED`
Expected: `x86_64 arm64` (either order) and `SIGNED`.

Run: `./build.sh --bogus; echo "exit $?"`
Expected: `unknown option: --bogus` and `exit 2`.

- [ ] **Step 4: Commit**

```bash
git add apps/menubar/build.sh
git commit -m "build(vast-bar): version from package.json, --universal for releases"
```

---

### Task 2: the install / status / uninstall logic

**Files:**
- Create: `src/utils/vast-bar.ts`
- Test: `tests/vast-bar.test.ts`

**Interfaces:**
- Consumes: `isNewer(candidate: string, current: string): boolean` from `src/utils/update-check.ts` (ignores prerelease suffixes).
- Produces (Tasks 3 and 4 rely on these exact names):
  - `BAR_ASSET = 'VastBar.zip'`, `BAR_APP = 'Vast Bar.app'`, `BAR_BUNDLE_ID = 'com.vastgroup.vastbar'`
  - `class BarError extends Error`
  - `interface BarDeps` (below)
  - `barUrl(version: string, env: Record<string, string | undefined>): string`
  - `installedBar(deps: BarDeps): string | null`
  - `barStatusLine(deps: BarDeps, cliVersion: string): string`
  - `installBar(opts: { cliVersion: string; version?: string; ifInstalled?: boolean }, deps: BarDeps): Promise<BarInstalled | null>` where `BarInstalled = { path: string; version: string; opened: boolean }`
  - `uninstallBar(opts: { purge: boolean }, deps: BarDeps): Promise<string[]>`

- [ ] **Step 1: Write the failing tests** — `tests/vast-bar.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --import tsx --test tests/vast-bar.test.ts 2>&1 | tail -5`
Expected: FAIL — `Cannot find module '../src/utils/vast-bar.js'`.

- [ ] **Step 3: Implement** — `src/utils/vast-bar.ts`:

```ts
/**
 * Installing Vast Bar, the macOS menu bar app, from the release that matches
 * this CLI. Every file and process step goes through BarDeps, so the whole
 * flow is tested without touching the machine (tests/vast-bar.test.ts); the
 * real steps live in src/commands/bar.ts.
 *
 * Why no Gatekeeper prompt: Gatekeeper only assesses files carrying
 * com.apple.quarantine, which browsers add and curl and ditto do not. The
 * install clears it anyway in case something else added it.
 */

import { dirname, join } from 'path';
import { isNewer } from './update-check.js';

export const BAR_ASSET = 'VastBar.zip';
export const BAR_APP = 'Vast Bar.app';
export const BAR_BUNDLE_ID = 'com.vastgroup.vastbar';
const REPO = 'MostafaAdly/vast-cli';

export class BarError extends Error {}

export interface BarDeps {
  platform: NodeJS.Platform;
  home: string;
  env: Record<string, string | undefined>;
  exists(path: string): boolean;
  writable(dir: string): boolean;
  makeTempDir(): string;
  mkdirp(dir: string): void;
  /** 'not-found' for a release without the asset (HTTP 404); throws on anything else that is not a success. */
  download(url: string, to: string): Promise<'ok' | 'not-found'>;
  unzip(zip: string, into: string): Promise<void>;
  plist(app: string): { id: string | null; version: string | null };
  verifySignature(app: string): Promise<boolean>;
  isRunning(): Promise<boolean>;
  /** Asks the app to quit and waits (up to ~5 s) for it to go. */
  quit(): Promise<void>;
  move(from: string, to: string): void;
  remove(path: string): void;
  clearQuarantine(app: string): Promise<void>;
  open(app: string): Promise<void>;
}

export interface BarInstalled {
  path: string;
  version: string;
  opened: boolean;
}

function assertMac(deps: BarDeps): void {
  if (deps.platform !== 'darwin') throw new BarError('Vast Bar is a macOS app.');
}

const bare = (v: string): string => v.trim().replace(/^v/, '');

export function barUrl(version: string, env: Record<string, string | undefined>): string {
  return env.VAST_BAR_URL || `https://github.com/${REPO}/releases/download/v${bare(version)}/${BAR_ASSET}`;
}

/** Where the app is installed now: /Applications first, then ~/Applications. */
export function installedBar(deps: BarDeps): string | null {
  for (const dir of ['/Applications', join(deps.home, 'Applications')]) {
    const path = join(dir, BAR_APP);
    if (deps.exists(path)) return path;
  }
  return null;
}

export function barStatusLine(deps: BarDeps, cliVersion: string): string {
  assertMac(deps);
  const app = installedBar(deps);
  if (!app) return 'Vast Bar is not installed — run vast bar install';
  const version = deps.plist(app).version ?? '?';
  const cli = bare(cliVersion);
  if (version !== '?' && isNewer(cli, version)) {
    return `Vast Bar ${version} is older than the CLI (${cli}) — run vast bar install`;
  }
  return `Vast Bar ${version} installed in ${dirname(app)} · CLI ${cli}`;
}

export async function installBar(
  opts: { cliVersion: string; version?: string; ifInstalled?: boolean },
  deps: BarDeps,
): Promise<BarInstalled | null> {
  assertMac(deps);
  const existing = installedBar(deps);
  if (opts.ifInstalled && !existing) return null;

  const version = bare(opts.version ?? opts.cliVersion);
  if (/[-+]/.test(version)) {
    throw new BarError(
      `This CLI (${version}) is a development build, so there is no released Vast Bar for it.\n` +
        'Build it from the repo: apps/menubar/build.sh',
    );
  }

  const tmp = deps.makeTempDir();
  try {
    const url = barUrl(version, deps.env);
    const zip = join(tmp, BAR_ASSET);
    if ((await deps.download(url, zip)) === 'not-found') {
      throw new BarError(`Release v${version} has no Vast Bar (it shipped from 2.9.0). Run vast upgrade first.`);
    }

    const unpacked = join(tmp, 'unpacked');
    deps.mkdirp(unpacked);
    await deps.unzip(zip, unpacked);
    const fresh = join(unpacked, BAR_APP);
    if (!deps.exists(fresh)) throw new BarError(`The download has no ${BAR_APP}: ${url}`);
    const { id, version: bundled } = deps.plist(fresh);
    if (id !== BAR_BUNDLE_ID) throw new BarError(`The download is not Vast Bar (bundle ${id ?? 'unknown'}): ${url}`);
    if (bundled !== version) throw new BarError(`The download is ${bundled ?? 'unversioned'}, expected ${version}: ${url}`);
    if (!(await deps.verifySignature(fresh))) throw new BarError(`The download's signature does not verify: ${url}`);

    let dir: string;
    if (existing) dir = dirname(existing);
    else if (deps.writable('/Applications')) dir = '/Applications';
    else {
      dir = join(deps.home, 'Applications');
      deps.mkdirp(dir);
    }
    const target = join(dir, BAR_APP);

    const wasRunning = await deps.isRunning();
    if (wasRunning) await deps.quit();

    // Swap with no gap: the old app steps aside, the new one moves in, and only
    // then is the old one deleted — so a failure can put it back.
    let previous: string | null = null;
    if (deps.exists(target)) {
      previous = join(tmp, 'previous.app');
      deps.move(target, previous);
    }
    try {
      deps.move(fresh, target);
    } catch (error) {
      if (previous) {
        deps.move(previous, target);
        if (wasRunning) await deps.open(target);
      }
      throw new BarError(`Could not install into ${dir}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (previous) deps.remove(previous);
    await deps.clearQuarantine(target);

    const opened = !opts.ifInstalled || wasRunning;
    if (opened) await deps.open(target);
    return { path: target, version, opened };
  } finally {
    deps.remove(tmp);
  }
}

export async function uninstallBar(opts: { purge: boolean }, deps: BarDeps): Promise<string[]> {
  assertMac(deps);
  const removed: string[] = [];
  const app = installedBar(deps);
  if (app) {
    if (await deps.isRunning()) await deps.quit();
    deps.remove(app);
    removed.push(app);
  }
  if (opts.purge) {
    const support = join(deps.home, 'Library', 'Application Support', 'Vast Bar');
    if (deps.exists(support)) {
      deps.remove(support);
      removed.push(support);
    }
  }
  return removed;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --import tsx --test tests/vast-bar.test.ts 2>&1 | grep -E "^# (pass|fail)"`
Expected: `# pass 17`, `# fail 0` (count may differ by the loop's 4 cases; zero failures is the requirement).

Note: the failed-swap test reassigns `mac.move`; if TypeScript objects, give the property an explicit type in `FakeMac`: `move: (from: string, to: string) => void = (from, to) => { … }`.

- [ ] **Step 5: Run the whole suite and typecheck, then commit**

Run: `npm test 2>&1 | grep -E "^# (pass|fail)" && npm run typecheck`
Expected: `# fail 0`; typecheck clean.

```bash
git add src/utils/vast-bar.ts tests/vast-bar.test.ts
git commit -m "feat(bar): install, status and uninstall logic for Vast Bar"
```

---

### Task 3: the `vast bar` command

**Files:**
- Create: `src/commands/bar.ts`
- Modify: `src/cli.ts` (import + `registerBarCommand(this.program);` before `registerUpgradeCommand`), `src/utils/help.ts` (SETUP rows)

**Interfaces:**
- Consumes: everything Task 2 produces; `VERSION` from `src/version.ts`; `log` from `src/utils/ui.ts`.
- Produces: `registerBarCommand(program: Command): void`, `liveBarDeps(): BarDeps`. CLI surface: `vast bar`, `vast bar install [-v, --version <tag>] [--if-installed]`, `vast bar uninstall [--purge]`.

- [ ] **Step 1: Write `src/commands/bar.ts`:**

```ts
/**
 * Bar Command
 *
 * Installs, reports and removes Vast Bar, the macOS menu bar app. The logic is
 * src/utils/vast-bar.ts; this file is its real hands (curl, ditto, plutil,
 * codesign, osascript, open) and the Commander wiring.
 */

import { Command } from 'commander';
import { execFile, execFileSync } from 'child_process';
import { accessSync, constants, cpSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from 'fs';
import { homedir, tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';
import { BAR_BUNDLE_ID, BarError, barStatusLine, installBar, uninstallBar, type BarDeps } from '../utils/vast-bar.js';
import { log } from '../utils/ui.js';
import { VERSION } from '../version.js';

const execFileAsync = promisify(execFile);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function running(): Promise<boolean> {
  try {
    await execFileAsync('pgrep', ['-x', 'VastBar']);
    return true;
  } catch {
    return false;
  }
}

export function liveBarDeps(): BarDeps {
  return {
    platform: process.platform,
    home: homedir(),
    env: process.env,
    exists: (p) => existsSync(p),
    writable: (dir) => {
      try {
        accessSync(dir, constants.W_OK);
        return true;
      } catch {
        return false;
      }
    },
    makeTempDir: () => mkdtempSync(join(tmpdir(), 'vast-bar-')),
    mkdirp: (dir) => mkdirSync(dir, { recursive: true }),
    download: async (url, to) => {
      // No -f: the status code tells a missing release (404) from a failure.
      const { stdout } = await execFileAsync('curl', ['-sSL', '-o', to, '-w', '%{http_code}', url]);
      const code = stdout.trim();
      if (url.startsWith('file:') || code === '200') return 'ok';
      if (code === '404') return 'not-found';
      throw new BarError(`Download failed (HTTP ${code}): ${url}`);
    },
    unzip: async (zip, into) => {
      await execFileAsync('ditto', ['-x', '-k', zip, into]);
    },
    plist: (app) => {
      const read = (key: string): string | null => {
        try {
          const value = execFileSync('plutil', ['-extract', key, 'raw', '-o', '-', join(app, 'Contents', 'Info.plist')], {
            encoding: 'utf-8',
          }).trim();
          return value || null;
        } catch {
          return null;
        }
      };
      return { id: read('CFBundleIdentifier'), version: read('CFBundleShortVersionString') };
    },
    verifySignature: async (app) => {
      try {
        await execFileAsync('codesign', ['--verify', '--deep', '--strict', app]);
        return true;
      } catch {
        return false;
      }
    },
    isRunning: running,
    quit: async () => {
      try {
        await execFileAsync('osascript', ['-e', `quit app id "${BAR_BUNDLE_ID}"`]);
      } catch {
        // Not running, or Apple Events refused: the wait below decides.
      }
      for (let i = 0; i < 50 && (await running()); i++) await sleep(100);
    },
    move: (from, to) => {
      try {
        renameSync(from, to);
      } catch (error) {
        // The temp dir can sit on another volume than Applications.
        if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
        cpSync(from, to, { recursive: true, verbatimSymlinks: true });
        rmSync(from, { recursive: true, force: true });
      }
    },
    remove: (p) => rmSync(p, { recursive: true, force: true }),
    clearQuarantine: async (app) => {
      try {
        await execFileAsync('xattr', ['-dr', 'com.apple.quarantine', app]);
      } catch {
        // Nothing to clear.
      }
    },
    open: async (app) => {
      await execFileAsync('open', [app]);
    },
  };
}

async function run(action: () => Promise<void> | void): Promise<void> {
  try {
    await action();
  } catch (error) {
    if (!(error instanceof BarError)) throw error;
    log.error(error.message);
    process.exitCode = 1;
  }
}

export function registerBarCommand(program: Command): void {
  const bar = program
    .command('bar')
    .description('Install and update Vast Bar, the macOS menu bar app')
    .addHelpText(
      'after',
      `
Examples:
  $ vast bar                    is it installed, and does it match this CLI?
  $ vast bar install            install it, or update it to this CLI's version
  $ vast bar uninstall --purge  remove it and its run logs

The app comes from the release matching this CLI (VastBar.zip), so it needs no
Xcode. vast upgrade updates it too when it is installed.
`,
    )
    .action(() => run(() => log.info(barStatusLine(liveBarDeps(), VERSION))));

  bar
    .command('install')
    .description("Install Vast Bar, or update it to this CLI's version")
    .option('-v, --version <tag>', 'Install the app from this release instead')
    .option('--if-installed', 'Only update an installed app (what vast upgrade runs)', false)
    .action((options: { version?: string; ifInstalled: boolean }) =>
      run(async () => {
        const result = await installBar(
          { cliVersion: VERSION, version: options.version, ifInstalled: options.ifInstalled },
          liveBarDeps(),
        );
        if (result) log.success(`Vast Bar ${result.version} installed in ${result.path.replace(/\/Vast Bar\.app$/, '')}`);
      }),
    );

  bar
    .command('uninstall')
    .description('Quit and remove Vast Bar')
    .option('--purge', 'Also remove its run logs (~/Library/Application Support/Vast Bar)', false)
    .action((options: { purge: boolean }) =>
      run(async () => {
        const removed = await uninstallBar({ purge: options.purge }, liveBarDeps());
        if (removed.length === 0) log.info('Vast Bar is not installed.');
        for (const path of removed) log.success(`removed ${path}`);
      }),
    );
}
```

- [ ] **Step 2: Wire it in.** In `src/cli.ts` add `import { registerBarCommand } from './commands/bar.js';` beside the other command imports, and `registerBarCommand(this.program);` on the line before `registerUpgradeCommand(this.program);`. In `src/utils/help.ts`, in the `SETUP` array after the `upgrade` row, add:

```ts
  { left: 'bar', right: 'Install or update Vast Bar, the macOS menu bar app' },
```

- [ ] **Step 3: Verify the CLI surface**

Run: `npm run typecheck && npx tsx src/cli.ts bar --help && npx tsx src/cli.ts bar install --help && npx tsx src/cli.ts bar uninstall --help && npx tsx src/cli.ts --help | grep -n "bar "`
Expected: typecheck clean; each help shows its options (`--version <tag>`, `--if-installed`, `--purge`) and examples; the root help lists `bar`.


Run: `npx tsx src/cli.ts bar install; echo "exit $?"`
Expected on this machine (CLI `2.8.1` from package.json): a download attempt of the `v2.8.1` asset → `Release v2.8.1 has no Vast Bar (it shipped from 2.9.0). Run vast upgrade first.` and `exit 1`, nothing changed in `/Applications`.

- [ ] **Step 4: Full suite and commit**

Run: `npm test 2>&1 | grep -E "^# (pass|fail)"` → `# fail 0`.

```bash
git add src/commands/bar.ts src/cli.ts src/utils/help.ts
git commit -m "feat(bar): vast bar, vast bar install and vast bar uninstall"
```

---

### Task 4: `vast upgrade` keeps the app in step

**Files:**
- Modify: `src/commands/upgrade.ts`
- Test: `tests/upgrade-bar.test.ts`

**Interfaces:**
- Consumes: `vastHome()` from `src/config/workspace.ts`; `log` from `src/utils/ui.ts`.
- Produces: `updateBarAfterUpgrade(deps?: { platform: NodeJS.Platform; home: string; run(file: string, args: string[]): void; warn(message: string): void }): void`

- [ ] **Step 1: Write the failing test** — `tests/upgrade-bar.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --import tsx --test tests/upgrade-bar.test.ts 2>&1 | tail -3`
Expected: FAIL — `updateBarAfterUpgrade` is not a function.

- [ ] **Step 3: Implement.** In `src/commands/upgrade.ts`, add (after `installedTag`):

```ts
/**
 * After the installer replaced the CLI, the NEW CLI brings Vast Bar to its own
 * version (it does nothing when the app is not installed). The CLI is already
 * upgraded, so a failure here is a warning, never a failed upgrade.
 */
export function updateBarAfterUpgrade(
  deps: {
    platform: NodeJS.Platform;
    home: string;
    run(file: string, args: string[]): void;
    warn(message: string): void;
  } = {
    platform: process.platform,
    home: vastHome(),
    run: (file, args) => {
      execFileSync(file, args, { stdio: 'inherit', timeout: 300_000 });
    },
    warn: (message) => log.warn(message),
  },
): void {
  if (deps.platform !== 'darwin') return;
  try {
    deps.run(process.execPath, [join(deps.home, 'vast.mjs'), 'bar', 'install', '--if-installed']);
  } catch (error) {
    deps.warn(
      `Vast Bar was not updated: ${error instanceof Error ? error.message : String(error)}\n` +
        '  The CLI upgrade is done. Run vast bar install to retry.',
    );
  }
}
```

and in `executeUpgrade`, immediately after the `try { … } catch { … process.exit(1); }` block that runs the installer, add:

```ts
  updateBarAfterUpgrade();
```

In the upgrade command's help text, add a line after "Re-runs the published installer…" paragraph:

```
On macOS it then updates Vast Bar too, if it is installed.
```

- [ ] **Step 4: Run to verify it passes, full suite, commit**

Run: `node --import tsx --test tests/upgrade-bar.test.ts 2>&1 | grep -E "^# (pass|fail)" && npm test 2>&1 | grep -E "^# (pass|fail)" && npm run typecheck`
Expected: `# pass 3`, then `# fail 0`, typecheck clean.

```bash
git add src/commands/upgrade.ts tests/upgrade-bar.test.ts
git commit -m "feat(upgrade): bring an installed Vast Bar to the new CLI's version"
```

---

### Task 5: "Open at login" in the app

**Files:**
- Create: `apps/menubar/Sources/VastBar/LoginItem.swift`
- Modify: `apps/menubar/Sources/VastBar/PopoverView.swift` (the power `Button` in the header, about lines 84–86)

**Interfaces:**
- Produces: `enum LoginItem { static var isEnabled: Bool; static func set(_ on: Bool) }`.

- [ ] **Step 1: Create `LoginItem.swift`:**

```swift
import Foundation
import ServiceManagement

/// "Open at login" through macOS's own login items (macOS 13+). Read fresh
/// each time, so a change made in System Settings shows.
enum LoginItem {
    static var isEnabled: Bool { SMAppService.mainApp.status == .enabled }

    static func set(_ on: Bool) {
        do {
            if on { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }
        } catch {
            NSLog("Vast Bar: could not change Open at login: \(error)")
        }
    }
}
```

- [ ] **Step 2: Replace the header's power button.** In `PopoverView.swift`, replace exactly this block:

```swift
                    Button { NSApplication.shared.terminate(nil) } label: { Image(systemName: "power") }
                        .foregroundStyle(.secondary)
                        .help("Quit Vast Bar")
```

with:

```swift
                    Menu {
                        Toggle("Open at login", isOn: Binding(get: { LoginItem.isEnabled }, set: { LoginItem.set($0) }))
                        Divider()
                        Button("Quit Vast Bar") { NSApplication.shared.terminate(nil) }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                    .menuStyle(.borderlessButton)
                    .menuIndicator(.hidden)
                    .fixedSize()
                    .foregroundStyle(.secondary)
                    .help("More")
```

- [ ] **Step 3: Verify**

Run: `cd apps/menubar && swift build 2>&1 | grep -E "error|warning:|Build complete" && swift test 2>&1 | grep -E "Executed .* tests" | tail -1 && ./build.sh --no-install`
Expected: `Build complete!` with no warnings; all tests pass; bundle built.

Run: `osascript -e 'quit app "Vast Bar"'; open "apps/menubar/build/Vast Bar.app"; sleep 4; pgrep -x VastBar && pkill -x VastBar`
Expected: a pid — it launches with the new header. (Toggling the item is checked in Task 7's live check, against the installed copy: `SMAppService` needs the app in an Applications folder.)

- [ ] **Step 4: Commit**

```bash
git add apps/menubar/Sources/VastBar/LoginItem.swift apps/menubar/Sources/VastBar/PopoverView.swift
git commit -m "feat(vast-bar): Open at login, from a menu beside Quit"
```

---

### Task 6: the release workflow builds and attaches the app

**Files:**
- Modify: `.github/workflows/release.yml` (whole file below)

**Interfaces:**
- Consumes: `apps/menubar/build.sh --no-install --universal` (Task 1).
- Produces: releases carry `vast.mjs` and `VastBar.zip`.

- [ ] **Step 1: Replace `.github/workflows/release.yml` with:**

```yaml
name: release

# Publishing is `npm version <patch|minor|major> && git push --follow-tags`.
# This builds the bundle that install.sh downloads and the Vast Bar app that
# `vast bar install` downloads, so a forgotten local build can never ship
# stale code to the team. Either build failing means no release at all.

on:
  push:
    tags:
      - 'v*'

permissions:
  contents: write

jobs:
  cli:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5

      - uses: actions/setup-node@v5
        with:
          node-version: 22

      - run: npm ci

      # Gate the release on a green suite. A tag that fails here produces no
      # release, which is the correct outcome — better no release than one that
      # installs a broken CLI over everyone's working copy.
      - run: npm test
      - run: npm run typecheck

      - run: npm run bundle

      - name: Verify the bundle actually runs
        run: |
          node build/vast.mjs --version
          node build/vast.mjs --help > /dev/null

      - name: Check the tag matches package.json
        run: |
          pkg="v$(node -p "require('./package.json').version")"
          tag="${GITHUB_REF_NAME}"
          if [ "$pkg" != "$tag" ]; then
            echo "Tag $tag does not match package.json ($pkg)."
            echo "Use 'npm version <patch|minor|major>' so the two stay in step."
            exit 1
          fi

      - uses: actions/upload-artifact@v4
        with:
          name: vast-mjs
          path: build/vast.mjs
          if-no-files-found: error

  app:
    runs-on: macos-15
    steps:
      - uses: actions/checkout@v5

      # build.sh reads the version from package.json with node.
      - uses: actions/setup-node@v5
        with:
          node-version: 22

      - run: swift --version

      - name: Test the app
        run: swift test
        working-directory: apps/menubar

      - name: Build the app (arm64 + x86_64)
        run: apps/menubar/build.sh --no-install --universal

      - name: Verify and zip the app
        run: |
          APP="apps/menubar/build/Vast Bar.app"
          codesign --verify --deep --strict "$APP"
          archs="$(lipo -archs "$APP/Contents/MacOS/VastBar")"
          case " $archs " in
            *" arm64 "*) ;;
            *) echo "missing arm64: $archs"; exit 1 ;;
          esac
          case " $archs " in
            *" x86_64 "*) ;;
            *) echo "missing x86_64: $archs"; exit 1 ;;
          esac
          version="$(plutil -extract CFBundleShortVersionString raw "$APP/Contents/Info.plist")"
          if [ "v$version" != "${GITHUB_REF_NAME}" ]; then
            echo "The app is $version but the tag is ${GITHUB_REF_NAME}."
            exit 1
          fi
          ditto -c -k --keepParent "$APP" VastBar.zip

      - uses: actions/upload-artifact@v4
        with:
          name: vast-bar-zip
          path: VastBar.zip
          if-no-files-found: error

  publish:
    needs: [cli, app]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v4
        with:
          path: assets
          merge-multiple: true

      - uses: softprops/action-gh-release@v2
        with:
          files: |
            assets/vast.mjs
            assets/VastBar.zip
          generate_release_notes: true
          fail_on_unmatched_files: true
```

- [ ] **Step 2: Lint it**

Run: `actionlint .github/workflows/release.yml && echo LINT-OK`
Expected: `LINT-OK`.

- [ ] **Step 3: Rehearse the app job's verify-and-zip locally** (proves the shell in the YAML, not just its syntax):

Run (from the repo root, after Task 1 is merged): `apps/menubar/build.sh --no-install --universal && GITHUB_REF_NAME="v$(node -p "require('./package.json').version")" bash -c "$(ruby -ryaml -e 'puts YAML.load_file(".github/workflows/release.yml")["jobs"]["app"]["steps"].find { |s| s["name"] == "Verify and zip the app" }["run"]')" && unzip -l VastBar.zip | head -5 && rm VastBar.zip`
Expected: no error; the listing shows `Vast Bar.app/Contents/...` entries.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci(release): build, verify and attach VastBar.zip beside vast.mjs"
```

---

### Task 7: docs, dist, and the live check

**Files:**
- Modify: `README.md`, `skills/release/SKILL.md`, `CLAUDE.md`, `dist/` (rebuilt)

**Interfaces:**
- Consumes: the CLI surface from Tasks 3–4, the workflow from Task 6.

- [ ] **Step 1: README.**
  - In `## Install`, after the CLI install command block, add: `On macOS, add the menu bar app with \`vast bar install\` — see [Vast Bar](#vast-bar-menu-bar-app).`
  - In the `## Commands` table, after the `vast upgrade` row, add: `| \`vast bar\` | Install, update or remove Vast Bar, the macOS menu bar app |`
  - In `## Vast Bar (menu bar app)` → `### Setting it up`: step 2 becomes `vast bar install` (it downloads the app matching your CLI, puts it in Applications and opens it; `vast upgrade` keeps it updated; `vast bar` shows what is installed; `vast bar uninstall [--purge]` removes it). Step 3 becomes the app's own **… → Open at login**. Move the clone + `apps/menubar/build.sh` instructions under a short "Building it yourself" paragraph (for development builds, which `vast bar install` refuses because no release matches them). Keep the Gatekeeper note: no warning appears because the download is not quarantined; an org security tool that blocks unsigned apps can still block it.
- [ ] **Step 2: SKILL.md.** Add one line where the skill lists commands it does not run: "`vast bar` installs the menu bar app; it is never part of a release you run."
- [ ] **Step 3: CLAUDE.md.** Under "Releasing this CLI": the workflow has three jobs (`cli` on Ubuntu, `app` on macOS 15, `publish` needing both) and two assets; `VastBar.zip` is never renamed, like `vast.mjs`; the app's version comes from `package.json`, so a tag/plist mismatch fails the app job. Under "Vast Bar": `vast bar install` downloads `VastBar.zip` with curl (no quarantine), verifies bundle id, version and signature before touching anything, and swaps in place; `vast upgrade` runs the new CLI's `bar install --if-installed`; `VAST_BAR_URL` overrides the download URL for live checks only.
- [ ] **Step 4: Verify every documented command and flag against the CLI, rebuild dist**

Run: `npm run build && node bin/vast.js bar --help && node bin/vast.js bar install --help && node bin/vast.js bar uninstall --help && node bin/vast.js upgrade --help | grep -i "vast bar" && npm test 2>&1 | grep -E "^# (pass|fail)" && npm run typecheck`
Expected: every documented flag appears in the help; `# fail 0`; typecheck clean.

- [ ] **Step 5: Live check (this Mac; no release needed)**

```bash
cd apps/menubar && ./build.sh --no-install --universal && cd ../..
ditto -c -k --keepParent "apps/menubar/build/Vast Bar.app" /tmp/VastBar.zip
V="$(node -p "require('./package.json').version")"
node bin/vast.js bar uninstall
VAST_BAR_URL="file:///tmp/VastBar.zip" node bin/vast.js bar install --version "$V"
node bin/vast.js bar
xattr -lr "/Applications/Vast Bar.app" | grep -c quarantine || true
pgrep -x VastBar
VAST_BAR_URL="file:///tmp/VastBar.zip" node bin/vast.js bar install --version "$V" --if-installed
```

Expected: uninstall removes the app; install prints `Vast Bar <V> installed in /Applications` and the app opens with no Gatekeeper dialog; `vast bar` prints `Vast Bar <V> installed in /Applications · CLI <V>`; the quarantine count is `0`; a pid; the `--if-installed` run replaces it in place and reopens it (it was running). Then in the app: **… → Open at login** shows a checkmark after clicking it, and System Settings → General → Login Items lists Vast Bar; click it again to turn it off.

Also: `node bin/vast.js bar install` (no `--version`, no override) on this `2.8.1` tree → `Release v2.8.1 has no Vast Bar …`, exit 1.

- [ ] **Step 6: Commit**

```bash
git add README.md skills/release/SKILL.md CLAUDE.md dist
git commit -m "docs(bar): vast bar install in the README, skill and CLAUDE.md; rebuild dist"
```
