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
/**
 * After the installer replaced the CLI, the NEW CLI brings Vast Bar to its own
 * version. Skipped when no app is installed, so a CLI too old to know `bar`
 * never warns about an app that was never there. The CLI is already upgraded,
 * so a failure here is a warning, never a failed upgrade.
 */
export declare function updateBarAfterUpgrade(deps?: {
    platform: NodeJS.Platform;
    /** The CLI's home (~/.vast-cli), where the new vast.mjs is. */
    home: string;
    exists(path: string): boolean;
    run(file: string, args: string[], timeoutMs: number): void;
    warn(message: string): void;
}): void;
export declare function registerUpgradeCommand(program: Command): void;
//# sourceMappingURL=upgrade.d.ts.map