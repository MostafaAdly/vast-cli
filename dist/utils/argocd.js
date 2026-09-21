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
/**
 * The API is not answering as an API: a load balancer is demanding a browser
 * sign-in in front of it.
 *
 * Staging's ArgoCD sits behind an AWS ALB `authenticate-oidc` rule, which
 * intercepts EVERY path — `/api/v1/session` included — and answers 302 to
 * Google. No token can get past that, and no amount of retrying will change it,
 * so it is its own error: the CLI reports it once, says who can fix it, and
 * carries on with the work that never needed ArgoCD.
 */
export class ArgoSsoWallError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ArgoSsoWallError';
    }
}
/** The statuses an ALB auth rule bounces an unauthenticated request with. */
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
function ssoWallMessage(host) {
    return (`ArgoCD's API at ${host} is behind a browser sign-in (SSO) at the load balancer, ` +
        'so the CLI cannot reach it. Ask DevOps to exempt /api/* from that rule; ' +
        "ArgoCD's own login still protects it.");
}
/**
 * Every call into the ArgoCD API goes through here, so the wall is detected in
 * exactly one place.
 *
 * `redirect: 'manual'` is the load-bearing part. Left to itself, fetch follows
 * the ALB's 302 to Google and returns a 200 text/html sign-in page, which then
 * reaches `JSON.parse` and dies as `Unexpected token '<'` — a message that
 * says nothing about what is actually wrong. The HTML check is the belt to
 * that braces: an intercepting proxy that answers 200 with a login page is the
 * same wall wearing a different status code.
 */
async function argoRequest(host, path, init, fetchFn) {
    const res = await fetchFn(`${host}${path}`, { ...init, redirect: 'manual' });
    if (REDIRECT_STATUSES.has(res.status))
        throw new ArgoSsoWallError(ssoWallMessage(host));
    if ((res.headers.get('content-type') ?? '').trim().toLowerCase().startsWith('text/html')) {
        throw new ArgoSsoWallError(ssoWallMessage(host));
    }
    return { res, body: await res.text() };
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
    const { res, body } = await argoRequest(host, '/api/v1/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
    }, fetchFn);
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
    const { res, body } = await argoRequest(host, '/api/v1/session/userinfo', { headers: { authorization: `Bearer ${token}` } }, fetchFn);
    if (res.status === 401 || res.status === 403)
        return { loggedIn: false };
    if (!res.ok)
        throw new Error(`argocd userinfo failed: ${serverMessage(body, res.status)}`);
    const parsed = JSON.parse(body);
    if (!parsed.loggedIn)
        return { loggedIn: false };
    return parsed.username ? { loggedIn: true, username: parsed.username } : { loggedIn: true };
}
export async function getApplication(host, token, app, fetchFn = fetch) {
    const { res, body } = await argoRequest(host, `/api/v1/applications/${encodeURIComponent(app)}`, { headers: { authorization: `Bearer ${token}` } }, fetchFn);
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
 * Ask ArgoCD to re-read git for this app right now.
 *
 * ArgoCD polls the repo every ~3 minutes; after a green build that poll is
 * most of the wait. With automated sync on, a refresh alone starts the rollout,
 * so the wait afterwards measures the rollout and not ArgoCD's timer. The
 * response body is the same application document and is deliberately ignored:
 * the waiter reads the state on its own schedule.
 */
export async function refreshApplication(host, token, app, fetchFn = fetch) {
    const { res, body } = await argoRequest(host, `/api/v1/applications/${encodeURIComponent(app)}?refresh=normal`, { headers: { authorization: `Bearer ${token}` } }, fetchFn);
    if (res.status === 401 || res.status === 403) {
        throw new ArgoUnauthorizedError(`argocd rejected the token: ${serverMessage(body, res.status)}`);
    }
    if (!res.ok) {
        throw new Error(`argocd refresh ${app}: ${serverMessage(body, res.status)}`);
    }
}
/**
 * 5s matches `pollRun`. Ten minutes is generous for a staging rollout and short
 * enough that a stuck sync does not hold a release open all afternoon.
 */
export const DEFAULT_ROLLOUT_TIMING = {
    pollMs: 5000,
    heartbeatMs: 30000,
    timeoutMs: 900000,
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
            // it rather than burning fifteen minutes per repo.
            // Nothing gets through an ALB auth rule, so twelve retries would only
            // turn a working deploy into a false failure a minute later. Say it once.
            if (error instanceof ArgoSsoWallError) {
                return {
                    ok: false,
                    elapsedMs: deps.now() - start,
                    reason: 'argocd api behind sso',
                    ssoWall: true,
                    app: lastApp,
                };
            }
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