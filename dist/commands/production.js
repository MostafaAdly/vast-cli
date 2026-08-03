/**
 * Production Command
 *
 * Manages the production safety lock. Production deploys are disabled by
 * default; this is the only way to lift that, and lifting it requires typing
 * the word out in full.
 */
import inquirer from 'inquirer';
import { isProductionEnabled, enableProduction, disableProduction, enabledSince, lockFile, } from '../config/production-lock.js';
import { createHeader, createSuccessBox, createInfoBox, log, formatKeyValue } from '../utils/ui.js';
function showStatus() {
    const enabled = isProductionEnabled();
    console.log(createInfoBox('Production lock', [
        formatKeyValue('State', enabled ? 'ENABLED — production deploys allowed' : 'LOCKED — production deploys refused'),
        formatKeyValue('Since', enabledSince() ?? 'n/a'),
        formatKeyValue('Lock file', lockFile()),
    ]));
    if (enabled) {
        log.warn('Production is currently unlocked. Run `vast production disable` when you are done.');
    }
}
async function enable(options) {
    if (isProductionEnabled()) {
        log.info('Production is already enabled.');
        return showStatus();
    }
    if (!options.yes) {
        const { typed } = await inquirer.prompt([
            {
                type: 'input',
                name: 'typed',
                message: 'This allows deploys to PRODUCTION. Type "enable production" to confirm:',
            },
        ]);
        if (typed.trim().toLowerCase() !== 'enable production') {
            log.info('Aborted. Production remains locked.');
            process.exitCode = 1;
            return;
        }
    }
    enableProduction(new Date().toISOString());
    console.log(createSuccessBox('Production deploys enabled', 'Re-lock with `vast production disable` as soon as you are finished.\n' +
        'Note: this CLI still never pushes to the production branch directly —\n' +
        'production is reached only through a reviewed release/X.Y.Z pull request.'));
}
function disable() {
    disableProduction();
    console.log(createSuccessBox('Production deploys locked', 'Production commands will now refuse.'));
}
export function registerProductionCommand(program) {
    const cmd = program
        .command('production')
        .description('Show or change the production deploy lock (locked by default)');
    cmd
        .command('status', { isDefault: true })
        .description('Show whether production deploys are allowed')
        .action(() => {
        console.log(createHeader('Production', 'safety lock'));
        showStatus();
    });
    cmd
        .command('enable')
        .description('Allow production deploys (requires typed confirmation)')
        .option('-y, --yes', 'Skip the typed confirmation', false)
        .action(enable);
    cmd
        .command('disable')
        .description('Refuse production deploys again')
        .action(disable);
}
//# sourceMappingURL=production.js.map