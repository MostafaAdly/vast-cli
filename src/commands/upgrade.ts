/**
 * Upgrade Command
 *
 * Re-runs the published installer, which is idempotent by design. Keeping one
 * install path means the upgrade route cannot drift from the install route —
 * whatever a new teammate gets is exactly what an upgrade gives you.
 */

import { Command } from 'commander';
import { execFileSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { vastHome } from '../config/workspace.js';
import { readState, normalize, isDue, refreshInBackground, isNewer } from '../utils/update-check.js';
import { createHeader, createErrorBox, log } from '../utils/ui.js';
import { installedBar } from '../utils/vast-bar.js';

const INSTALL_URL = 'https://raw.githubusercontent.com/MostafaAdly/vast-cli/main/install.sh';

/** The release tag this install came from, if it came from a release. */
export function installedTag(): string | null {
  const file = join(vastHome(), 'version');
  if (!existsSync(file)) return null;
  const tag = readFileSync(file, 'utf-8').trim();
  return tag || null;
}

/** Above curl's own limit for the app download, so curl's clear message wins a slow download. */
const BAR_UPDATE_TIMEOUT_MS = 900_000;

/**
 * After the installer replaced the CLI, the NEW CLI brings Vast Bar to its own
 * version. Skipped when no app is installed, so a CLI too old to know `bar`
 * never warns about an app that was never there. The CLI is already upgraded,
 * so a failure here is a warning, never a failed upgrade.
 */
export function updateBarAfterUpgrade(
  deps: {
    platform: NodeJS.Platform;
    /** The CLI's home (~/.vast-cli), where the new vast.mjs is. */
    home: string;
    exists(path: string): boolean;
    run(file: string, args: string[], timeoutMs: number): void;
    warn(message: string): void;
  } = {
    platform: process.platform,
    home: vastHome(),
    exists: (path) => existsSync(path),
    run: (file, args, timeoutMs) => {
      execFileSync(file, args, { stdio: 'inherit', timeout: timeoutMs });
    },
    warn: (message) => log.warn(message),
  },
): void {
  if (deps.platform !== 'darwin') return;
  if (!installedBar({ home: homedir(), exists: deps.exists })) return;
  try {
    deps.run(process.execPath, [join(deps.home, 'vast.mjs'), 'bar', 'install', '--if-installed'], BAR_UPDATE_TIMEOUT_MS);
  } catch (error) {
    // Neutral on purpose: the app may be updated and only failed to open; the
    // child has already printed the specific message.
    deps.warn(
      `Vast Bar update did not finish: ${error instanceof Error ? error.message : String(error)}\n` +
        '  The CLI upgrade is done. Run vast bar install to retry.',
    );
  }
}

async function executeUpgrade(options: { version?: string; check: boolean }): Promise<void> {
  console.log(createHeader('Upgrade', 'Vast CLI'));

  const installed = installedTag();

  if (options.check) {
    // Fetch when the cache cannot answer. The never-block rule governs the
    // BACKGROUND hint; --check is an explicit question, and "no information
    // cached yet" is not an answer — least of all on a fresh install, where the
    // cache stays empty for a day and an agent asking "am I current?" learns
    // nothing.
    let state = readState();
    if (!state?.latest || isDue(state, Date.now())) {
      await refreshInBackground(Date.now());
      state = readState();
    }

    if (!state?.latest) {
      log.warn('Could not reach GitHub to check for updates.');
      return;
    }
    if (installed && !isNewer(state.latest, installed)) {
      log.success(`Up to date (${normalize(installed)}).`);
      return;
    }
    log.info(`Latest is ${normalize(state.latest)}; you have ${installed ? normalize(installed) : 'a source install'}.`);
    return;
  }

  // A source checkout has no release tag and is upgraded with git, not by
  // overwriting it with a bundle.
  if (!installed) {
    console.log(
      createErrorBox(
        'This looks like a source install',
        'No release tag is recorded, so this was installed from a clone rather\n' +
          'than the installer. Upgrade it with git instead:\n\n' +
          '    cd <your vast-cli checkout>\n' +
          '    git pull && npm install && npm run build\n\n' +
          'Or switch to a release install by running the installer.',
      ),
    );
    process.exit(1);
  }

  log.info(`Currently on ${normalize(installed)}. Fetching the installer...`);

  try {
    const script = execFileSync('curl', ['-fsSL', INSTALL_URL], {
      encoding: 'utf-8',
      timeout: 30_000,
    });

    // Piped to bash with stdin as the script, so the installer's own
    // `vast init` step will correctly detect no terminal and skip.
    execFileSync('bash', ['-s'], {
      input: script,
      stdio: ['pipe', 'inherit', 'inherit'],
      env: options.version ? { ...process.env, VAST_VERSION: options.version } : process.env,
      timeout: 300_000,
    });
  } catch (error) {
    console.log(
      createErrorBox(
        'Upgrade failed',
        `${error instanceof Error ? error.message : String(error)}\n\n` +
          `Your existing install is untouched. Try again, or install manually:\n\n` +
          `    curl -fsSL ${INSTALL_URL} | bash`,
      ),
    );
    process.exit(1);
  }

  updateBarAfterUpgrade();
}

export function registerUpgradeCommand(program: Command): void {
  program
    .command('upgrade')
    .description('Update Vast CLI to the latest release')
    .option('-v, --version <tag>', 'Install a specific release tag')
    .option('-c, --check', 'Report what is available without installing', false)
    .addHelpText(
      'after',
      `
Examples:
  $ vast upgrade              install the latest release
  $ vast upgrade --check      say what is available, change nothing
  $ vast upgrade -v v1.2.0    pin a specific release

Re-runs the published installer, so an upgrade lands exactly what a fresh
install would. If you installed from a git clone, use git pull instead.
On macOS it then updates Vast Bar too, if it is installed.
`,
    )
    .action(executeUpgrade);
}
