/**
 * Upgrade Command
 *
 * Re-runs the published installer, which is idempotent by design. Keeping one
 * install path means the upgrade route cannot drift from the install route —
 * whatever a new teammate gets is exactly what an upgrade gives you.
 */
import { Command } from 'commander';
/** The release tag this install came from, if it came from a release. */
export declare function installedTag(): string | null;
export declare function registerUpgradeCommand(program: Command): void;
//# sourceMappingURL=upgrade.d.ts.map