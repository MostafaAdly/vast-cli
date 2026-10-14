/**
 * Bar Command
 *
 * Installs, reports and removes Vast Bar, the macOS menu bar app. The logic is
 * src/utils/vast-bar.ts; this file is its real hands (curl, ditto, plutil,
 * codesign, osascript, open) and the Commander wiring.
 */
import { Command } from 'commander';
import { type BarDeps } from '../utils/vast-bar.js';
export declare function liveBarDeps(): BarDeps;
export declare function registerBarCommand(program: Command): void;
//# sourceMappingURL=bar.d.ts.map