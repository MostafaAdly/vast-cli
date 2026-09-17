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
/** The token is missing, expired, or rejected. Distinct so callers can say so. */
export declare class ArgoUnauthorizedError extends Error {
    constructor(message: string);
}
export interface ArgoApp {
    /** Synced | OutOfSync | Unknown */
    syncStatus: string;
    /** Healthy | Progressing | Degraded | Missing | Unknown */
    healthStatus: string;
    /** Fully-qualified images currently running, e.g. `registry/pwa:1.2.3`. */
    images: string[];
    revision: string;
}
type FetchFn = typeof fetch;
/**
 * Exchange a username and password for a session token.
 *
 * The password is only ever a request body field: it is never logged, never
 * echoed back, and never included in a thrown message.
 */
export declare function login(host: string, username: string, password: string, fetchFn?: FetchFn): Promise<string>;
/**
 * Whether a token is still good.
 *
 * A rejected token is an answer, not a failure — `vast argocd status` wants to
 * print "expired", not blow up — so 401/403 returns `{ loggedIn: false }`.
 */
export declare function userinfo(host: string, token: string, fetchFn?: FetchFn): Promise<{
    loggedIn: boolean;
    username?: string;
}>;
export declare function getApplication(host: string, token: string, app: string, fetchFn?: FetchFn): Promise<ArgoApp>;
/**
 * Ask ArgoCD to re-read git for this app right now.
 *
 * ArgoCD polls the repo every ~3 minutes; after a green build that poll is
 * most of the wait. With automated sync on, a refresh alone starts the rollout,
 * so the wait afterwards measures the rollout and not ArgoCD's timer. The
 * response body is the same application document and is deliberately ignored:
 * the waiter reads the state on its own schedule.
 */
export declare function refreshApplication(host: string, token: string, app: string, fetchFn?: FetchFn): Promise<void>;
export interface RolloutDeps {
    getApp: () => Promise<ArgoApp>;
    sleep: (ms: number) => Promise<void>;
    now: () => number;
    print: (line: string) => void;
}
export interface RolloutTiming {
    pollMs: number;
    heartbeatMs: number;
    /** Ceiling on the whole wait. */
    timeoutMs: number;
    /** Consecutive failed reads before giving up. */
    maxConsecutiveErrors: number;
}
/**
 * 5s matches `pollRun`. Ten minutes is generous for a staging rollout and short
 * enough that a stuck sync does not hold a release open all afternoon.
 */
export declare const DEFAULT_ROLLOUT_TIMING: RolloutTiming;
export interface RolloutResult {
    ok: boolean;
    elapsedMs: number;
    /** Why it is not ok. Absent on success. */
    reason?: string;
    /** The last application state read, when one was read. */
    app?: ArgoApp;
}
/** The tag has to be live AND settled — a Synced/Healthy old image is not a rollout. */
export declare function rolloutDone(app: ArgoApp, tag: string): boolean;
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
export declare function waitForRollout(label: string, appName: string, tag: string, deps: RolloutDeps, timing?: RolloutTiming, isDone?: (app: ArgoApp) => boolean): Promise<RolloutResult>;
export {};
//# sourceMappingURL=argocd.d.ts.map