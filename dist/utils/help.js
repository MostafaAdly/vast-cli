/**
 * Root help screen.
 *
 * Commander's default help is a flat, monochrome list of commands. The thing
 * that is actually hard to learn here is not what each command does — it is
 * which command belongs at which stage of develop -> staging -> production. So
 * the flow leads, commands are grouped by purpose, and worked examples show the
 * version each one derives.
 *
 * Everything below is pure string building except `lockState()`, which reads
 * the production gates so the screen reflects the machine it is run on.
 */
import { colors } from './ui.js';
import { isProductionEnabled, productionPipelineReady } from '../config/production-lock.js';
/** Target width. Keeps the screen intact in an 80-column terminal. */
export const WIDTH = 76;
/** Left margin of a command or example row. */
const INDENT = 4;
const SETUP = [
    { left: 'init', right: 'Find your Vast checkouts and remember where they are' },
    { left: 'clone', right: 'Clone the repos your team needs' },
    { left: 'argocd', right: 'Log in to ArgoCD so deploys can be confirmed' },
    { left: 'upgrade', right: 'Update to the latest release' },
];
const INSPECT = [
    { left: 'status', right: 'Deployed versions and branch drift, all repos' },
];
const SHIP = [
    { left: 'release', right: 'Promote develop→staging, derive version, deploy, wait for ArgoCD' },
    { left: 'promote', right: 'Merge branches, or open a release/hotfix PR' },
    { left: 'deploy', right: 'Dispatch a version and wait for ArgoCD to roll it out' },
    { left: 'workflow', right: 'Trigger a raw GitHub Actions workflow' },
];
const EXAMPLES = [
    { left: 'vast status --all', right: 'what is live everywhere' },
    { left: 'vast release VastPayPwa', right: '1.5.5-rc15 → 1.5.5-rc16' },
    { left: 'vast release VastPayPwa --bump minor', right: '1.5.5-rc15 → 1.6.0-rc1' },
    { left: 'vast release VastPayPwa -n', right: 'dry run, changes nothing' },
];
/** Width of the widest left-hand cell across the given rows, plus a gutter. */
export function columnWidth(rows, gutter = 2) {
    return Math.max(...rows.map((r) => r.left.length)) + gutter;
}
export function heading(text) {
    return `  ${colors.primary.bold(text)}`;
}
/**
 * Break a description into lines that fit the right-hand column.
 *
 * One SHIP description is long enough to push past WIDTH on its own, and a
 * description that wraps wherever the terminal happens to end is worse than one
 * that wraps where we chose — so we wrap it here, on a word, under the column.
 */
function fitRight(text, available) {
    const lines = [];
    let line = '';
    for (const word of text.split(' ')) {
        if (line && line.length + 1 + word.length > available) {
            lines.push(line);
            line = word;
        }
        else {
            line = line ? `${line} ${word}` : word;
        }
    }
    if (line)
        lines.push(line);
    return lines;
}
/** A command row: violet name, plain description, wrapped under the column. */
export function commandRow(row, width) {
    const available = Math.max(WIDTH - INDENT - width, 1);
    const [first, ...rest] = fitRight(row.right, available);
    const pad = ' '.repeat(INDENT + width);
    return [
        `${' '.repeat(INDENT)}${colors.highlight.bold(row.left.padEnd(width))}${first ?? ''}`,
        ...rest.map((l) => `${pad}${l}`),
    ].join('\n');
}
/** An example row: blue invocation, muted outcome. */
export function exampleRow(row, width) {
    return `${' '.repeat(INDENT)}${colors.info(row.left.padEnd(width))}${colors.muted(row.right)}`;
}
/**
 * The pipeline, with the command that moves you along each hop.
 *
 * Branches escalate in colour left to right — blue, amber, red — because the
 * consequence of a mistake escalates the same way. Production shows only the
 * promote hop: the deploy behind it is blocked until production is migrated,
 * and offering a command that always refuses teaches the wrong flow.
 */
export function flowDiagram() {
    const arrow = colors.muted('──▶');
    return [
        `    ${colors.info('develop')}  ${arrow}  ${colors.warning('staging')}  ${arrow}  ${colors.error('production')}`,
        `               ${colors.info('vast release')}    ${colors.info('vast promote --to production')}`,
        `                               ${colors.muted('(production deploy blocked until migrated)')}`,
    ].join('\n');
}
/**
 * Live production state.
 *
 * Two gates, and the order matters: the pipeline block is a statement about the
 * world and the file lock is only a permission, so while production has not
 * been migrated the screen says BLOCKED whichever way the lock stands — showing
 * ENABLED there would promise a deploy that always refuses.
 *
 * Once that block lifts, locked is rendered green: the lock is the protection,
 * so the safe state gets the reassuring colour and the unlocked state gets the
 * one that earns attention. This is deliberately the inverse of the "lock icon
 * = red" instinct.
 */
export function lockState(state) {
    const ready = state?.ready ?? productionPipelineReady();
    if (!ready) {
        return `${colors.error('● BLOCKED')} ${colors.muted('— production not migrated (lock ignored)')}`;
    }
    const enabled = state?.enabled ?? isProductionEnabled();
    return enabled
        ? `${colors.warning('● ENABLED')} ${colors.muted('— production deploys allowed')}`
        : `${colors.success('● LOCKED')} ${colors.muted('— production deploys refused')}`;
}
export function renderRootHelp(version) {
    const cmdWidth = columnWidth([...SETUP, ...INSPECT, ...SHIP, { left: 'production', right: '' }]);
    const exWidth = columnWidth(EXAMPLES);
    return [
        '',
        `  ${colors.primary.bold('VAST CLI')}  ${colors.muted(`v${version}`)}`,
        `  ${colors.muted('Release tooling for Vast Group')}`,
        '',
        heading('THE EVERYDAY FLOW'),
        flowDiagram(),
        '',
        heading('SETUP'),
        ...SETUP.map((r) => commandRow(r, cmdWidth)),
        '',
        heading('INSPECT'),
        ...INSPECT.map((r) => commandRow(r, cmdWidth)),
        '',
        heading('SHIP'),
        ...SHIP.map((r) => commandRow(r, cmdWidth)),
        '',
        heading('SAFETY'),
        commandRow({ left: 'production', right: 'Show or change the production deploy lock' }, cmdWidth),
        `    ${' '.repeat(cmdWidth)}${lockState()}`,
        '',
        heading('EXAMPLES'),
        ...EXAMPLES.map((r) => exampleRow(r, exWidth)),
        '',
        heading('GLOBAL OPTIONS'),
        `    ${colors.muted('-V, --version    -h, --help    --verbose')}`,
        '',
        `  ${colors.muted('vast')} ${colors.highlight('<command>')} ${colors.muted('--help')}   ${colors.muted('for options and more examples')}`,
        '',
    ].join('\n');
}
//# sourceMappingURL=help.js.map