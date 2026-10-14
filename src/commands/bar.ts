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
import { BAR_BUNDLE_ID, BAR_DOWNLOAD_MAX_SECONDS, BarError, barStatusLine, installBar, uninstallBar, type BarDeps } from '../utils/vast-bar.js';
import { log } from '../utils/ui.js';
import { VERSION } from '../version.js';

const execFileAsync = promisify(execFile);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** This user's processes only: not another login's copy, not a dev binary named differently. */
const mine = (): string[] => ['-x', '-U', String(process.getuid?.() ?? '')];

async function running(): Promise<boolean> {
  try {
    await execFileAsync('pgrep', [...mine(), 'VastBar']);
    return true;
  } catch {
    return false;
  }
}

/** Polls for up to `ms` for the app to go; true once it has. */
async function gone(ms: number): Promise<boolean> {
  for (let waited = 0; await running(); waited += 100) {
    if (waited >= ms) return false;
    await sleep(100);
  }
  return true;
}

/** The first line a failed command printed, for a readable BarError. */
function firstLine(error: unknown): string {
  const { stderr, message } = error as { stderr?: string; message?: string };
  return (stderr?.trim() || message || String(error)).split('\n')[0].trim();
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
      let code: string;
      try {
        const { stdout } = await execFileAsync('curl', [
          '-sSL',
          '--connect-timeout',
          '15',
          '--max-time',
          String(BAR_DOWNLOAD_MAX_SECONDS),
          '-o',
          to,
          '-w',
          '%{http_code}',
          url,
        ]);
        code = stdout.trim();
      } catch (error) {
        // No network, a timeout, a missing file:// path.
        throw new BarError(`Download failed: ${firstLine(error)}: ${url}`);
      }
      if (url.startsWith('file:') || code === '200') return 'ok';
      if (code === '404') return 'not-found';
      throw new BarError(`Download failed (HTTP ${code}): ${url}`);
    },
    unzip: async (zip, into) => {
      try {
        await execFileAsync('ditto', ['-x', '-k', zip, into]);
      } catch (error) {
        // Typically an HTML error page saved as the zip.
        throw new BarError(`The download is not a valid zip: ${firstLine(error)}`);
      }
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
        // Bounded: an unanswered Automation prompt ("Terminal wants to control
        // Vast Bar") would otherwise hold osascript for about two minutes.
        await execFileAsync('osascript', ['-e', `quit app id "${BAR_BUNDLE_ID}"`], { timeout: 10_000 });
      } catch {
        // Not running, Apple Events refused, or timed out: the wait below decides.
      }
      if (await gone(5000)) return true;
      // Automation denied, Apple Events failing, or the app hung: SIGTERM it.
      try {
        await execFileAsync('pkill', [...mine(), 'VastBar']);
      } catch {
        // Already gone, or not ours to signal: the wait decides.
      }
      return gone(2000);
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
      // Right after the old copy quits, LaunchServices can still be letting go
      // of it and `open` fails with -600; it clears within a second or two.
      for (let attempt = 1; ; attempt++) {
        try {
          await execFileAsync('open', [app]);
          return;
        } catch (error) {
          if (attempt === 8) throw error;
          await sleep(500);
        }
      }
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
    .option('--if-installed', 'Only update an installed app, and only to a different version (what vast upgrade runs)', false)
    .action((options: { version?: string; ifInstalled: boolean }) =>
      run(async () => {
        const result = await installBar(
          { cliVersion: VERSION, version: options.version, ifInstalled: options.ifInstalled },
          liveBarDeps(),
        );
        if (!result) return;
        log.success(`Vast Bar ${result.version} installed in ${result.path.replace(/\/Vast Bar\.app$/, '')}`);
        if (result.warning) log.warn(result.warning);
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
