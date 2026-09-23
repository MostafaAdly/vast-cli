/**
 * The slice of the Slack Web API the release announcement needs.
 *
 * Uses Node's global `fetch` (Node >= 18) rather than adding an HTTP client,
 * and takes the fetch to use as its last argument so the suite can run the
 * whole client against scripted responses — no test ever reaches slack.com, and
 * no test ever posts a message.
 *
 * Slack answers 200 to almost everything and puts the real outcome in `ok`, so
 * the status code is not what decides success here; `ok` is. The token appears
 * only in the authorization header: never in a log line, never in an error.
 */
type FetchFn = typeof fetch;
/** A Slack API call that came back `ok: false`. The message is Slack's own code. */
export declare class SlackError extends Error {
    constructor(message: string);
}
/** Who the token belongs to. Used to prove a token works before storing it. */
export declare function authTest(token: string, fetchFn?: FetchFn): Promise<{
    team: string;
    user: string;
    teamId: string;
}>;
/**
 * The Slack member id for an email address, or null when Slack has never seen
 * it.
 *
 * "Not found" is an ordinary answer, not a failure: plenty of commit addresses
 * are noreply forwarders or personal addresses nobody signed up to Slack with,
 * and the message simply names those people in plain text instead. Any other
 * error (a missing scope, a dead token) is real and is raised.
 */
export declare function lookupUserByEmail(token: string, email: string, fetchFn?: FetchFn): Promise<string | null>;
/**
 * Post one message.
 *
 * Unfurling is off on both links and media: the message is a dense single line
 * of PR and ClickUp links, and Slack would otherwise stack a preview card under
 * each one and bury the next release.
 *
 * When blocks are given, Slack renders them and uses `text` only for the
 * notification and for clients that cannot draw blocks — so both are sent.
 */
export declare function postMessage(token: string, channel: string, text: string, fetchFn?: FetchFn, blocks?: unknown[]): Promise<{
    ts: string;
    channel: string;
}>;
/**
 * Add the bot to a channel.
 *
 * Raises on failure like everything else — the caller decides whether it
 * matters. Setup treats it as best effort, because a private channel cannot be
 * joined this way at all and has to be invited by a human.
 */
export declare function joinChannel(token: string, channelId: string, fetchFn?: FetchFn): Promise<void>;
/**
 * The channel id for a channel name, or null.
 *
 * `chat.postMessage` accepts a name, but every other call wants an id, and a
 * typo'd name is much better caught during setup than at release time. Private
 * channels are included so a team that announces in one is not told their
 * channel does not exist. Paging is followed to the end: a workspace with more
 * than 1000 channels would otherwise lose the ones late in the alphabet.
 */
/** Slack channel ids are upper-case, start with C (public), G (private) or D (DM). */
export declare function isChannelId(value: string): boolean;
/**
 * The name behind a channel id, so setup can confirm what the user typed and
 * status can show something a person recognises. Unknown id → null.
 */
export declare function channelInfo(token: string, id: string, fetchFn?: FetchFn): Promise<{
    id: string;
    name: string;
    isDm: boolean;
} | null>;
export declare function findChannelId(token: string, name: string, fetchFn?: FetchFn): Promise<string | null>;
export {};
//# sourceMappingURL=slack.d.ts.map