/**
 * ArgoCD API client and the rollout waiter.
 *
 * Under GitOps the build workflow only commits a tag; ArgoCD is what actually
 * ships it. So "released" means ArgoCD reports the new image Synced and
 * Healthy, and that is what `waitForRollout` waits for.
 *
 * Uses Node's global `fetch` (Node >= 18) rather than adding an HTTP client.
 * Every side effect in the waiter is injected — the read, the clock, the sleep,
 * the printer — so it is tested against scripted application states and a fake
 * clock, never against a real server.
 */
import { formatElapsed } from './run-poll.js';
/** The token is missing, expired, or rejected. Distinct so callers can say so. */
export class ArgoUnauthorizedError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ArgoUnauthorizedError';
    }
}
/** Best-effort message out of an ArgoCD error body, which is `{error, message}`. */
function serverMessage(body, status) {
    try {
        const parsed = JSON.parse(body);
        const text = parsed.error ?? parsed.message;
        if (text)
            return text;
    }
    catch {
        // Not JSON — a proxy or an HTML error page. Fall through.
    }
    return body.trim() ? `HTTP ${status}: ${body.trim().slice(0, 200)}` : `HTTP ${status}`;
}
/**
 * Exchange a username and password for a session token.
 *
 * The password is only ever a request body field: it is never logged, never
 * echoed back, and never included in a thrown message.
 */
export async function login(host, username, password, fetchFn = fetch) {
    const res = await fetchFn(`${host}/api/v1/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
    });
    const body = await res.text();
    if (!res.ok)
        throw new Error(`argocd login failed: ${serverMessage(body, res.status)}`);
    const token = JSON.parse(body).token;
    if (!token)
        throw new Error('argocd login returned no token');
    return token;
}
/**
 * Whether a token is still good.
 *
 * A rejected token is an answer, not a failure — `vast argocd status` wants to
 * print "expired", not blow up — so 401/403 returns `{ loggedIn: false }`.
 */
export async function userinfo(host, token, fetchFn = fetch) {
    const res = await fetchFn(`${host}/api/v1/session/userinfo`, {
        headers: { authorization: `Bearer ${token}` },
    });
    if (res.status === 401 || res.status === 403)
        return { loggedIn: false };
    const body = await res.text();
    if (!res.ok)
        throw new Error(`argocd userinfo failed: ${serverMessage(body, res.status)}`);
    const parsed = JSON.parse(body);
    if (!parsed.loggedIn)
        return { loggedIn: false };
    return parsed.username ? { loggedIn: true, username: parsed.username } : { loggedIn: true };
}
export async function getApplication(host, token, app, fetchFn = fetch) {
    const res = await fetchFn(`${host}/api/v1/applications/${encodeURIComponent(app)}`, {
        headers: { authorization: `Bearer ${token}` },
    });
    const body = await res.text();
    if (res.status === 401 || res.status === 403) {
        throw new ArgoUnauthorizedError(`argocd rejected the token: ${serverMessage(body, res.status)}`);
    }
    if (!res.ok) {
        throw new Error(`argocd application ${app}: ${serverMessage(body, res.status)}`);
    }
    const status = JSON.parse(body).status;
    return {
        syncStatus: status?.sync?.status ?? 'Unknown',
        healthStatus: status?.health?.status ?? 'Unknown',
        images: status?.summary?.images ?? [],
        revision: status?.sync?.revision ?? '',
    };
}
/**
 * 5s matches `pollRun`. Ten minutes is generous for a staging rollout and short
 * enough that a stuck sync does not hold a release open all afternoon.
 */
export const DEFAULT_ROLLOUT_TIMING = {
    pollMs: 5000,
    heartbeatMs: 30000,
    timeoutMs: 600000,
    maxConsecutiveErrors: 12,
};
/** The tag has to be live AND settled — a Synced/Healthy old image is not a rollout. */
export function rolloutDone(app, tag) {
    return hasTag(app, tag) && app.healthStatus === 'Healthy' && app.syncStatus === 'Synced';
}
/** `:` anchors the match so `:11.2.3` never satisfies a wait for `1.2.3`. */
function hasTag(app, tag) {
    return app.images.some((image) => image.endsWith(`:${tag}`));
}
/**
 * Watch one ArgoCD application until it runs `tag` Synced and Healthy.
 *
 * Shaped like `pollRun`: one plain line per state change plus a heartbeat, so a
 * multi-repo release can print several rollouts onto one board without any of
 * them repainting the terminal.
 *
 * `isDone` is the definition of "rolled out", and it is a parameter because
 * `rolloutDone` alone is a snapshot: an app already running `tag` satisfies it
 * on the very first read, so re-deploying a live version would return ok having
 * waited for nothing. A caller that knows the tag was already live passes a
 * predicate that also demands a new revision. The printed state text is
 * deliberately NOT derived from it — while a custom predicate says "not yet"
 * the app still genuinely has the tag, and `waiting for <tag>` would be a lie.
 */
export async function waitForRollout(label, appName, tag, deps, timing = DEFAULT_ROLLOUT_TIMING, isDone = (app) => rolloutDone(app, tag)) {
    const start = deps.now();
    let lastState = null;
    let lastPrintedAt = 0;
    let consecutiveErrors = 0;
    let lastApp;
    for (;;) {
        let current = null;
        try {
            current = await deps.getApp();
            consecutiveErrors = 0;
        }
        catch (error) {
            // A bad token will never come good by waiting, and every other repo in
            // the release is about to hit the same wall. Stop now and say what fixes
            // it rather than burning ten minutes per repo.
            if (error instanceof ArgoUnauthorizedError) {
                return {
                    ok: false,
                    elapsedMs: deps.now() - start,
                    reason: 'argocd unauthorized — run `vast argocd login`',
                    app: lastApp,
                };
            }
            consecutiveErrors++;
            // Say something once when a streak starts: a silent minute followed by a
            // failure reads as a hang. Once only, so an outage does not scroll.
            if (consecutiveErrors === 1) {
                deps.print(`  ${label}  argocd ${appName}  read failed, retrying  ${formatElapsed(deps.now() - start)}`);
            }
            if (consecutiveErrors >= timing.maxConsecutiveErrors) {
                return {
                    ok: false,
                    elapsedMs: deps.now() - start,
                    reason: `could not read argocd application ${appName}: ${error instanceof Error ? error.message : String(error)}`,
                    app: lastApp,
                };
            }
        }
        if (current) {
            lastApp = current;
            const elapsed = deps.now() - start;
            if (isDone(current))
                return { ok: true, elapsedMs: elapsed, app: current };
            // Before the tag shows up, sync/health describe the OLD image and would
            // read as a finished deploy. Say what we are actually waiting for.
            const state = hasTag(current, tag)
                ? `${current.syncStatus}/${current.healthStatus}`
                : `waiting for ${tag}`;
            if (state !== lastState || elapsed - lastPrintedAt >= timing.heartbeatMs) {
                deps.print(`  ${label}  argocd ${appName}  ${state}  ${formatElapsed(elapsed)}`);
                lastState = state;
                lastPrintedAt = elapsed;
            }
        }
        const elapsed = deps.now() - start;
        if (elapsed >= timing.timeoutMs) {
            return {
                ok: false,
                elapsedMs: elapsed,
                reason: `timed out after ${formatElapsed(timing.timeoutMs)}`,
                app: lastApp,
            };
        }
        await deps.sleep(timing.pollMs);
    }
}
//# sourceMappingURL=argocd.js.map