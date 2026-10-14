/**
 * Installing Vast Bar, the macOS menu bar app, from the release that matches
 * this CLI. Every file and process step goes through BarDeps, so the whole
 * flow is tested without touching the machine (tests/vast-bar.test.ts); the
 * real steps live in src/commands/bar.ts.
 *
 * Why no Gatekeeper prompt: Gatekeeper only assesses files carrying
 * com.apple.quarantine, which browsers add and curl and ditto do not. The
 * install clears it anyway in case something else added it.
 */
import { dirname, join } from 'path';
import { isNewer } from './update-check.js';
export const BAR_ASSET = 'VastBar.zip';
export const BAR_APP = 'Vast Bar.app';
export const BAR_BUNDLE_ID = 'com.vastgroup.vastbar';
const REPO = 'MostafaAdly/vast-cli';
/** curl's --max-time for the download; vast upgrade's wait for the app step must exceed it. */
export const BAR_DOWNLOAD_MAX_SECONDS = 600;
export class BarError extends Error {
}
function assertMac(deps) {
    if (deps.platform !== 'darwin')
        throw new BarError('Vast Bar is a macOS app.');
}
const bare = (v) => v.trim().replace(/^v/, '');
const message = (error) => (error instanceof Error ? error.message : String(error));
const NOT_QUIT = 'Vast Bar did not quit. Quit it from its … menu and run the command again.';
const STAGED = '.Vast Bar.new.app';
const PREVIOUS = '.Vast Bar.previous.app';
const APP_DIRS = (deps) => ['/Applications', join(deps.home, 'Applications')];
export function barUrl(version, env) {
    return env.VAST_BAR_URL || `https://github.com/${REPO}/releases/download/v${bare(version)}/${BAR_ASSET}`;
}
/** Where the app is installed now: /Applications first, then ~/Applications. */
export function installedBar(deps) {
    for (const dir of APP_DIRS(deps)) {
        const path = join(dir, BAR_APP);
        if (deps.exists(path))
            return path;
    }
    return null;
}
/** The copy a swap interrupted between its two renames left behind, if any. */
function interruptedBar(deps) {
    for (const dir of APP_DIRS(deps)) {
        const path = join(dir, PREVIOUS);
        if (deps.exists(path))
            return path;
    }
    return null;
}
export function barStatusLine(deps, cliVersion) {
    assertMac(deps);
    const app = installedBar(deps);
    if (!app) {
        const left = interruptedBar(deps);
        if (left) {
            return `Vast Bar is not installed, but an interrupted install left it at ${left} — rename it to "Vast Bar.app" or run vast bar install`;
        }
        return 'Vast Bar is not installed — run vast bar install';
    }
    const version = deps.plist(app).version ?? '?';
    const cli = bare(cliVersion);
    if (version !== '?' && isNewer(cli, version)) {
        return `Vast Bar ${version} is older than the CLI (${cli}) — run vast bar install`;
    }
    return `Vast Bar ${version} installed in ${dirname(app)} · CLI ${cli}`;
}
export async function installBar(opts, deps) {
    assertMac(deps);
    const existing = installedBar(deps);
    if (opts.ifInstalled && !existing)
        return null;
    const version = bare(opts.version ?? opts.cliVersion);
    if (/[-+]/.test(version)) {
        throw new BarError(`This CLI (${version}) is a development build, so there is no released Vast Bar for it.\n` +
            'Build it from the repo: apps/menubar/build.sh');
    }
    if (!/^\d+\.\d+\.\d+$/.test(version)) {
        throw new BarError(`--version must look like 2.9.0 (got ${version}).`);
    }
    // Under vast upgrade an app already at this version is left alone: no
    // download, no quit and reopen. A plain install reinstalls, as asked.
    if (opts.ifInstalled && existing && deps.plist(existing).version === version)
        return null;
    // The temp dir holds only the zip and the unpacked copy; the swap itself
    // happens inside the install dir.
    const tmp = deps.makeTempDir();
    try {
        const url = barUrl(version, deps.env);
        const zip = join(tmp, BAR_ASSET);
        if ((await deps.download(url, zip)) === 'not-found') {
            throw new BarError(`Release v${version} has no Vast Bar (it shipped from 2.9.0). Run vast upgrade first.`);
        }
        const unpacked = join(tmp, 'unpacked');
        deps.mkdirp(unpacked);
        await deps.unzip(zip, unpacked);
        const fresh = join(unpacked, BAR_APP);
        if (!deps.exists(fresh))
            throw new BarError(`The download has no ${BAR_APP}: ${url}`);
        const { id, version: bundled } = deps.plist(fresh);
        if (id !== BAR_BUNDLE_ID)
            throw new BarError(`The download is not Vast Bar (bundle ${id ?? 'unknown'}): ${url}`);
        if (bundled !== version)
            throw new BarError(`The download is ${bundled ?? 'unversioned'}, expected ${version}: ${url}`);
        if (!(await deps.verifySignature(fresh)))
            throw new BarError(`The download's signature does not verify: ${url}`);
        // An interrupted swap's leftover marks where the app was: go back there.
        const where = existing ?? interruptedBar(deps);
        let dir;
        if (where)
            dir = dirname(where);
        else if (deps.writable('/Applications'))
            dir = '/Applications';
        else {
            dir = join(deps.home, 'Applications');
            deps.mkdirp(dir);
        }
        // Checked before anything is quit, so a folder we can't write never
        // strands the app closed.
        if (deps.exists(dir) && !deps.writable(dir)) {
            throw new BarError(`${dir} is not writable for you, so Vast Bar can't be installed or updated there without admin rights. ` +
                'Remove it with admin rights, or install to ~/Applications by removing the copy in /Applications first.');
        }
        const target = join(dir, BAR_APP);
        const staged = join(dir, STAGED);
        const previous = join(dir, PREVIOUS);
        // A leftover with no app beside it is the user's only copy, from a swap
        // interrupted between its renames: put it back as the app first, so a
        // failure below still leaves a working one. Never delete it.
        if (!deps.exists(target) && deps.exists(previous)) {
            try {
                deps.move(previous, target);
            }
            catch (error) {
                throw new BarError(`An interrupted install left Vast Bar at ${previous} and it could not be put back (${message(error)}): ` +
                    'rename it to "Vast Bar.app", then run vast bar install again.');
            }
        }
        // A leftover beside an installed app is stale: cleared before anything is
        // quit or moved. If it can't be, stop here: it must never be mistaken for
        // the copy this run set aside.
        if (deps.exists(previous)) {
            try {
                deps.remove(previous);
            }
            catch {
                throw new BarError(`An earlier install left ${previous} and it can't be removed (it may need admin rights). ` +
                    'Remove it, then run vast bar install again.');
            }
        }
        // Stage the new app beside the old one, so the swap below is two renames
        // within one folder: they cannot cross volumes or run out of disk halfway.
        // Anything that goes wrong here has touched nothing installed.
        if (deps.exists(staged))
            deps.remove(staged);
        try {
            deps.move(fresh, staged);
        }
        catch (error) {
            deps.remove(staged);
            throw new BarError(`Could not stage Vast Bar in ${dir}: ${message(error)}`);
        }
        let wasRunning = false;
        let warning;
        try {
            wasRunning = await deps.isRunning();
            // Never swap the bundle a running app is executing from.
            if (wasRunning && !(await deps.quit()))
                throw new BarError(NOT_QUIT);
            // Set only once THIS run has moved the installed app aside: the one
            // fact that makes `previous` ours to restore.
            let movedAside = false;
            try {
                if (deps.exists(target)) {
                    deps.move(target, previous);
                    movedAside = true;
                }
                deps.move(staged, target);
            }
            catch (error) {
                let kept = '';
                if (movedAside) {
                    try {
                        deps.remove(target);
                        deps.move(previous, target);
                    }
                    catch {
                        kept = `. Your previous Vast Bar is kept at ${previous}`;
                    }
                }
                if (wasRunning && deps.exists(target)) {
                    try {
                        await deps.open(target);
                    }
                    catch {
                        // The error below is the one that matters.
                    }
                }
                throw new BarError(`Could not install into ${dir}: ${message(error)}${kept}`);
            }
            if (movedAside) {
                try {
                    deps.remove(previous);
                }
                catch {
                    // The new app is in place; an old copy we can't delete must not stop it opening.
                    warning = `The previous Vast Bar is left at ${previous}; remove it when convenient.`;
                }
            }
        }
        finally {
            try {
                if (deps.exists(staged))
                    deps.remove(staged);
            }
            catch {
                // Best effort: never replace the error on its way out.
            }
        }
        await deps.clearQuarantine(target);
        const opened = !opts.ifInstalled || wasRunning;
        if (opened) {
            try {
                await deps.open(target);
            }
            catch {
                // The install itself succeeded; only the launch did not.
                throw new BarError(`Vast Bar ${version} is installed in ${dir}, but macOS would not open it yet — open it from Applications.`);
            }
        }
        return { path: target, version, opened, ...(warning ? { warning } : {}) };
    }
    finally {
        try {
            deps.remove(tmp);
        }
        catch {
            // Best effort: a temp dir left behind is not worth failing for.
        }
    }
}
export async function uninstallBar(opts, deps) {
    assertMac(deps);
    const removed = [];
    const app = installedBar(deps);
    if (app) {
        if ((await deps.isRunning()) && !(await deps.quit()))
            throw new BarError(NOT_QUIT);
        deps.remove(app);
        removed.push(app);
    }
    if (opts.purge) {
        const support = join(deps.home, 'Library', 'Application Support', 'Vast Bar');
        if (deps.exists(support)) {
            deps.remove(support);
            removed.push(support);
        }
    }
    return removed;
}
//# sourceMappingURL=vast-bar.js.map