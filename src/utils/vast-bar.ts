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
