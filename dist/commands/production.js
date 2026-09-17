/**
 * Production Command
 *
 * Manages the production safety lock. Production deploys are disabled by
 * default; this is the only way to lift that, and lifting it requires typing
 * the word out in full.
 */
import inquirer from 'inquirer';
import { isProductionEnabled, enableProduction, disableProduction, enabledSince, lockFile, productionPipelineReady, PRODUCTION_NOT_READY_MESSAGE, } from '../config/production-lock.js';
import { createHeader, createSuccessBox, createErrorBox, createInfoBox, log, formatKeyValue, } from '../utils/ui.js';
function showStatus() {
    const enabled = isProductionEnabled();
    const ready = productionPipelineReady();
    console.log(createInfoBox('Production lock', [
        // The pipeline line comes first because it outranks the lock: while it
        // says "not migrated", the lock's state changes nothing.
        formatKeyValue('Pipeline', ready ? 'migrated — deploys allowed' : 'not migrated — deploys blocked'),
        formatKeyValue('State', enabled ? 'ENABLED — production deploys allowed' : 'LOCKED — production deploys refused'),
        formatKeyValue('Since', enabledSince() ?? 'n/a'),
        formatKeyValue('Lock file', lockFile()),
    ]));
    if (!ready) {
        log.warn('Production has not moved to the new deploy pipeline — every production ' +
            'deploy path refuses regardless of this lock.');
    }
    if (enabled && ready) {
        log.warn('Production is currently unlocked. Run `vast production disable` when you are done.');
    }
}
async function enable(options) {
    // Lifting the lock would be a lie while the pipeline is blocked: every
    // production deploy path refuses before it ever reads the lock file.
    if (!productionPipelineReady()) {
        console.log(createErrorBox('Production deploys are blocked', PRODUCTION_NOT_READY_MESSAGE));
        process.exitCode = 1;
        return;
    }
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
        .description('Show or change the production deploy lock (locked by default)')
        .addHelpText('after', `
Examples:
  $ vast production            show the current state (same as: status)
  $ vast production enable     allow production deploys
  $ vast production disable    refuse them again

Production is currently BLOCKED above this lock: it has not moved to the new
Vast-deployments + ArgoCD deploy pipeline, so \`vast production enable\` refuses
and every production deploy path refuses before the lock is even read.

What the lock does and does not cover:

  LOCKED blocks    vast deploy --to production
                   vast workflow --branch production

  Always allowed   vast promote --to production            cut release/X.Y.Z + PR
                   vast promote --to production --as hotfix

Preparing a release ships nothing, so it is never gated. Independently of both
gates, this CLI never pushes to production at all — production is reached only
by merging the reviewed release PR.
`);
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