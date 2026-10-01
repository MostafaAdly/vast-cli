/**
 * Tell the user a release or deploy has finished, so they can walk away from
 * the terminal while the build and the rollout run — up to 15 minutes.
 *
 * A desktop notification plus the terminal bell, only for real runs that took
 * longer than a minute: a quick run is still on screen, and a dry run ships
 * nothing. VAST_NOTIFY=0 turns it off. Never throws — a notification that
 * cannot be shown must not fail a deploy that already succeeded.
 */
import type { DeployOutcome } from '../commands/deploy.js';
export declare const NOTIFY_AFTER_MS = 60000;
export interface DoneMessage {
    title: string;
    body: string;
}
/** @returns null when nothing was dispatched, so there is nothing to report. */
export declare function doneMessage(outcomes: DeployOutcome[], env: string): DoneMessage | null;
export declare function shouldAnnounce(run: {
    dryRun: boolean;
    elapsedMs: number;
    env: NodeJS.ProcessEnv;
}): boolean;
export interface NotifyDeps {
    platform: NodeJS.Platform;
    run: (cmd: string, args: string[]) => void;
    has: (cmd: string) => boolean;
}
/**
 * The title and body reach osascript as argv and are read inside the script
 * with `item n of argv`, so a repo name or an error message is only ever data,
 * never AppleScript.
 */
export declare function desktopNotify(message: DoneMessage, deps?: NotifyDeps): void;
/** Desktop notification and terminal bell, when the run earned one. */
export declare function announceDone(outcomes: DeployOutcome[], env: string, run: {
    dryRun: boolean;
    startedAt: number;
}): void;
//# sourceMappingURL=done-notify.d.ts.map