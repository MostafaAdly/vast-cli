/**
 * Tell the user a release or deploy has finished, so they can walk away from
 * the terminal while the build and the rollout run — up to 15 minutes.
 *
 * A desktop notification plus the terminal bell, only for real runs that took
 * longer than a minute: a quick run is still on screen, and a dry run ships
 * nothing. VAST_NOTIFY=0 turns it off. Never throws — a notification that
 * cannot be shown must not fail a deploy that already succeeded.
 */
import { execFileSync } from 'child_process';
export const NOTIFY_AFTER_MS = 60_000;
/** The deploy summary's own wording for a build whose rollout ArgoCD did not confirm. */
const isUnconfirmed = (o) => o.detail.includes('rollout not confirmed');
/** @returns null when nothing was dispatched, so there is nothing to report. */
export function doneMessage(outcomes, env) {
    const released = outcomes.filter((o) => o.status === 'released');
    const failed = outcomes.filter((o) => o.status === 'failed');
    if (released.length + failed.length === 0)
        return null;
    const title = `vast · ${env}${failed.length ? ` — ${failed.length} failed` : ''}`;
    if (released.length + failed.length === 1) {
        const [only] = [...released, ...failed];
        if (only.status === 'failed')
            return { title: `vast · ${env} — failed`, body: `${only.repo} failed` };
        const state = isUnconfirmed(only) ? 'tag committed, rollout not confirmed' : 'is live';
        return { title, body: `${only.repo} ${only.version} ${state}` };
    }
    const unconfirmed = released.filter(isUnconfirmed).length;
    const parts = [
        released.length - unconfirmed ? `${released.length - unconfirmed} live` : '',
        unconfirmed ? `${unconfirmed} not confirmed` : '',
        failed.length ? `${failed.length} failed: ${failed.map((o) => o.repo).join(', ')}` : '',
    ].filter(Boolean);
    return { title, body: parts.join(', ') };
}
export function shouldAnnounce(run) {
    if (run.dryRun || run.env.VAST_NOTIFY === '0')
        return false;
    return run.elapsedMs >= NOTIFY_AFTER_MS;
}
const DEFAULT_DEPS = {
    platform: process.platform,
    run: (cmd, args) => {
        execFileSync(cmd, args, { stdio: 'ignore', timeout: 5000 });
    },
    has: (cmd) => {
        try {
            execFileSync('which', [cmd], { stdio: 'ignore' });
            return true;
        }
        catch {
            return false;
        }
    },
};
/**
 * The title and body reach osascript as argv and are read inside the script
 * with `item n of argv`, so a repo name or an error message is only ever data,
 * never AppleScript.
 */
export function desktopNotify(message, deps = DEFAULT_DEPS) {
    try {
        if (deps.platform === 'darwin') {
            deps.run('osascript', [
                '-e',
                'on run argv',
                '-e',
                'display notification (item 2 of argv) with title (item 1 of argv) sound name "Glass"',
                '-e',
                'end run',
                message.title,
                message.body,
            ]);
        }
        else if (deps.platform === 'linux' && deps.has('notify-send')) {
            deps.run('notify-send', [message.title, message.body]);
        }
    }
    catch {
        // Deliberately silent: no notification permission, no display, no daemon.
    }
}
/** Desktop notification and terminal bell, when the run earned one. */
export function announceDone(outcomes, env, run) {
    if (!shouldAnnounce({ dryRun: run.dryRun, elapsedMs: Date.now() - run.startedAt, env: process.env }))
        return;
    const message = doneMessage(outcomes, env);
    if (!message)
        return;
    if (process.stdout.isTTY)
        process.stdout.write('\x07');
    desktopNotify(message);
}
//# sourceMappingURL=done-notify.js.map