/**
 * Production safety lock.
 *
 * Production deploys are DISABLED BY DEFAULT, hard-coded. Nothing in this CLI
 * touches the `production` branch or dispatches a production build unless the
 * lock has been explicitly lifted with `vast production enable`.
 *
 * The lock is a file rather than a constant so that lifting it is a deliberate,
 * auditable act that does not require editing and rebuilding source — and so
 * that it can be dropped again in one command.
 */
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
/** Hard-coded default. Production is off until a file says otherwise. */
const PRODUCTION_ENABLED_BY_DEFAULT = false;
/**
 * VAST_CLI_HOME exists so the test suite can exercise enable/disable against a
 * throwaway directory. Without it a crashed test could leave the real lock
 * lifted, which is exactly the state this module exists to prevent.
 */
export function lockFile() {
    const home = process.env.VAST_CLI_HOME ?? join(homedir(), '.vast-cli');
    return join(home, 'production-enabled');
}
export function isProductionEnabled() {
    if (PRODUCTION_ENABLED_BY_DEFAULT)
        return true;
    return existsSync(lockFile());
}
/** When the lock was lifted, or null if it is still in place. */
export function enabledSince() {
    const file = lockFile();
    if (!existsSync(file))
        return null;
    try {
        return readFileSync(file, 'utf-8').trim() || 'unknown';
    }
    catch {
        return 'unknown';
    }
}
export function enableProduction(stamp) {
    const file = lockFile();
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${stamp}\n`, 'utf-8');
}
export function disableProduction() {
    rmSync(lockFile(), { force: true });
}
/** Human-readable refusal, shared by every production code path. */
export const PRODUCTION_LOCKED_MESSAGE = [
    'Production deploys are locked. Nothing was built or shipped.',
    '',
    'Preparing a release is NOT locked — you can still run:',
    '  vast promote <repo> --to production              cut release/X.Y.Z + PR',
    '  vast promote <repo> --to production --as hotfix  cut hotfix/X.Y.Z + PR',
    '',
    'Lift the deploy lock: vast production enable',
    'Check the state:      vast production status',
].join('\n');
//# sourceMappingURL=production-lock.js.map