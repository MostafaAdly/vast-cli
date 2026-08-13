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
 * the production lock so the screen reflects the machine it is run on.
 */
import { colors } from './ui.js';
import { isProductionEnabled } from '../config/production-lock.js';
/** Target width. Keeps the screen intact in an 80-column terminal. */
export const WIDTH = 76;
const SETUP = [
    { left: 'init', right: 'Find your Vast checkouts and remember where they are' },
    { left: 'clone', right: 'Clone the repos your team needs' },
    { left: 'upgrade', right: 'Update to the latest release' },
];
const INSPECT = [
    { left: 'status', right: 'Deployed versions and branch drift, all repos' },
];
const SHIP = [
    { left: 'release', right: 'Promote develop→staging, derive version, deploy' },
    { left: 'promote', right: 'Merge branches, or open a release/hotfix PR' },
    { left: 'deploy', right: 'Ship a version already on the branch' },
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
/** A command row: violet name, plain description. */
export function commandRow(row, width) {
    return `    ${colors.highlight.bold(row.left.padEnd(width))}${row.right}`;
}
/** An example row: blue invocation, muted outcome. */
export function exampleRow(row, width) {
    return `    ${colors.info(row.left.padEnd(width))}${colors.muted(row.right)}`;
}
/**
 * The pipeline, with the command that moves you along each hop.
 *
 * Branches escalate in colour left to right — blue, amber, red — because the
 * consequence of a mistake escalates the same way.
 */
export function flowDiagram() {
    const arrow = colors.muted('──▶');
    return [
        `    ${colors.info('develop')}  ${arrow}  ${colors.warning('staging')}  ${arrow}  ${colors.error('production')}`,
        `               ${colors.info('vast release')}    ${colors.info('vast promote --to production')}`,
        `                               ${colors.info('vast deploy  --to production')}`,
    ].join('\n');
}
/**
 * Live production-lock state.
 *
 * Locked is rendered green: the lock is the protection, so the safe state gets
 * the reassuring colour and the unlocked state gets the one that earns
 * attention. This is deliberately the inverse of the "lock icon = red" instinct.
 */
export function lockState() {
    return isProductionEnabled()
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