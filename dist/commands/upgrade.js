/**
 * Upgrade Command
 *
 * Re-runs the published installer, which is idempotent by design. Keeping one
 * install path means the upgrade route cannot drift from the install route —
 * whatever a new teammate gets is exactly what an upgrade gives you.
 */
import { execFileSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { vastHome } from '../config/workspace.js';
import { readState, normalize } from '../utils/update-check.js';
import { createHeader, createErrorBox, log } from '../utils/ui.js';
const INSTALL_URL = 'https://raw.githubusercontent.com/MostafaAdly/vast-cli/main/install.sh';
/** The release tag this install came from, if it came from a release. */
export function installedTag() {
    const file = join(vastHome(), 'version');
    if (!existsSync(file))
        return null;
    const tag = readFileSync(file, 'utf-8').trim();
    return tag || null;
}
async function executeUpgrade(options) {
    console.log(createHeader('Upgrade', 'Vast CLI'));
    const installed = installedTag();
    if (options.check) {
        const state = readState();
        if (!state?.latest) {
            log.info('No update information cached yet. Run `vast upgrade` to fetch and install the latest.');
            return;
        }
        if (installed && normalize(state.latest) === normalize(installed)) {
            log.success(`Up to date (${normalize(installed)}).`);
            return;
        }
        log.info(`Latest is ${normalize(state.latest)}; you have ${installed ? normalize(installed) : 'a source install'}.`);
        return;
    }
    // A source checkout has no release tag and is upgraded with git, not by
    // overwriting it with a bundle.
    if (!installed) {
        console.log(createErrorBox('This looks like a source install', 'No release tag is recorded, so this was installed from a clone rather\n' +
            'than the installer. Upgrade it with git instead:\n\n' +
            '    cd <your vast-cli checkout>\n' +
            '    git pull && npm install && npm run build\n\n' +
            'Or switch to a release install by running the installer.'));
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
    }
    catch (error) {
        console.log(createErrorBox('Upgrade failed', `${error instanceof Error ? error.message : String(error)}\n\n` +
            `Your existing install is untouched. Try again, or install manually:\n\n` +
            `    curl -fsSL ${INSTALL_URL} | bash`));
        process.exit(1);
    }
}
export function registerUpgradeCommand(program) {
    program
        .command('upgrade')
        .description('Update Vast CLI to the latest release')
        .option('-v, --version <tag>', 'Install a specific release tag')
        .option('-c, --check', 'Report what is available without installing', false)
        .addHelpText('after', `
Examples:
  $ vast upgrade              install the latest release
  $ vast upgrade --check      say what is available, change nothing
  $ vast upgrade -v v1.2.0    pin a specific release

Re-runs the published installer, so an upgrade lands exactly what a fresh
install would. If you installed from a git clone, use git pull instead.
`)
        .action(executeUpgrade);
}
//# sourceMappingURL=upgrade.js.map