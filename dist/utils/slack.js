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
const API = 'https://slack.com/api';
/** A Slack API call that came back `ok: false`. The message is Slack's own code. */
export class SlackError extends Error {
    constructor(message) {
        super(message);
        this.name = 'SlackError';
    }
}
function authHeader(token) {
    return { authorization: `Bearer ${token}` };
}
/**
 * Every call lands here, so "Slack said no" is detected in exactly one place.
 *
 * A non-JSON body (a proxy page, an outage splash) would otherwise die inside
 * JSON.parse with a message that says nothing about what went wrong.
 */
async function call(url, init, fetchFn) {
    const res = await fetchFn(url, init);
    const body = await res.text();
    let parsed;
    try {
        parsed = JSON.parse(body);
    }
    catch {
        throw new SlackError(body.trim() ? `slack returned a non-JSON response (HTTP ${res.status})` : `HTTP ${res.status}`);
    }
    if (!parsed.ok)
        throw new SlackError(parsed.error ?? `HTTP ${res.status}`);
    return parsed;
}
function post(url, token, payload, fetchFn) {
    return call(url, {
        method: 'POST',
        headers: { ...authHeader(token), 'content-type': 'application/json' },
        body: JSON.stringify(payload),
    }, fetchFn);
}
/** Who the token belongs to. Used to prove a token works before storing it. */
export async function authTest(token, fetchFn = fetch) {
    const body = await call(`${API}/auth.test`, { method: 'POST', headers: authHeader(token) }, fetchFn);
    return { team: body.team ?? '', user: body.user ?? '', teamId: body.team_id ?? '' };
}
/**
 * The Slack member id for an email address, or null when Slack has never seen
 * it.
 *
 * "Not found" is an ordinary answer, not a failure: plenty of commit addresses
 * are noreply forwarders or personal addresses nobody signed up to Slack with,
 * and the message simply names those people in plain text instead. Any other
 * error (a missing scope, a dead token) is real and is raised.
 */
export async function lookupUserByEmail(token, email, fetchFn = fetch) {
    const url = `${API}/users.lookupByEmail?${new URLSearchParams({ email }).toString()}`;
    try {
        const body = await call(url, { headers: authHeader(token) }, fetchFn);
        return body.user?.id ?? null;
    }
    catch (error) {
        if (error instanceof SlackError && error.message === 'users_not_found')
            return null;
        throw error;
    }
}
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
export async function postMessage(token, channel, text, fetchFn = fetch, blocks) {
    const payload = blocks
        ? { channel, text, blocks, unfurl_links: false, unfurl_media: false }
        : { channel, text, unfurl_links: false, unfurl_media: false };
    const body = (await post(`${API}/chat.postMessage`, token, payload, fetchFn));
    return { ts: body.ts ?? '', channel: body.channel ?? channel };
}
/**
 * Add the bot to a channel.
 *
 * Raises on failure like everything else — the caller decides whether it
 * matters. Setup treats it as best effort, because a private channel cannot be
 * joined this way at all and has to be invited by a human.
 */
export async function joinChannel(token, channelId, fetchFn = fetch) {
    await post(`${API}/conversations.join`, token, { channel: channelId }, fetchFn);
}
/** How many channels to ask for per page. 1000 is Slack's documented ceiling. */
const PAGE_SIZE = '1000';
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
export function isChannelId(value) {
    return /^[CGD][A-Z0-9]{8,}$/.test(value);
}
/**
 * The name behind a channel id, so setup can confirm what the user typed and
 * status can show something a person recognises. Unknown id → null.
 */
export async function channelInfo(token, id, fetchFn = fetch) {
    try {
        const body = await call(`${API}/conversations.info?${new URLSearchParams({ channel: id }).toString()}`, { headers: authHeader(token) }, fetchFn);
        if (!body.channel?.id)
            return null;
        // A direct message has no name of its own; say what it is instead.
        const isDm = body.channel.is_im === true;
        return { id: body.channel.id, name: isDm ? 'direct message' : (body.channel.name ?? id), isDm };
    }
    catch (error) {
        if (error instanceof SlackError && error.message === 'channel_not_found')
            return null;
        throw error;
    }
}
export async function findChannelId(token, name, fetchFn = fetch) {
    const wanted = name.trim().replace(/^#/, '').toLowerCase();
    let cursor = '';
    // Bounded by Slack's own paging: an empty next_cursor ends it.
    for (;;) {
        const params = new URLSearchParams({
            types: 'public_channel,private_channel',
            limit: PAGE_SIZE,
            exclude_archived: 'true',
        });
        if (cursor)
            params.set('cursor', cursor);
        const body = await call(`${API}/conversations.list?${params.toString()}`, { headers: authHeader(token) }, fetchFn);
        const hit = body.channels?.find((channel) => channel.name?.toLowerCase() === wanted);
        if (hit?.id)
            return hit.id;
        cursor = body.response_metadata?.next_cursor?.trim() ?? '';
        if (!cursor)
            return null;
    }
}
//# sourceMappingURL=slack.js.map