/**
 * Slack Command
 *
 * Manages the bot token and channel that `vast promote --slack` announces a
 * release into. One setup per token lifetime, stored 0600 under the CLI home.
 *
 * The token is read hidden, proven once against auth.test, and never stored in
 * a log line or printed back — `status` says whether one exists and whether it
 * still works, and nothing more.
 */
import { Command } from 'commander';
export declare function registerSlackCommand(program: Command): void;
//# sourceMappingURL=slack.d.ts.map