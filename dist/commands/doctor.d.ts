/**
 * Doctor Command
 *
 * One read-only screen answering "will a release work from here right now?",
 * so the next quiet change upstream is found before a deploy, not during one.
 * The checks themselves live in `src/utils/doctor.ts`; this file wires them to
 * the real readers and prints the result.
 */
import { Command } from 'commander';
import { type Check } from '../utils/doctor.js';
export declare function renderChecks(checks: Check[]): string[];
export declare function registerDoctorCommand(program: Command): void;
//# sourceMappingURL=doctor.d.ts.map