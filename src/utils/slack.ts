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

type FetchFn = typeof fetch;

/** A Slack API call that came back `ok: false`. The message is Slack's own code. */
export class SlackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SlackError';
  }
}

interface SlackResponse {
  ok?: boolean;
  error?: string;
}

function authHeader(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

/**
 * Every call lands here, so "Slack said no" is detected in exactly one place.
 *
 * A non-JSON body (a proxy page, an outage splash) would otherwise die inside
 * JSON.parse with a message that says nothing about what went wrong.
 */
async function call<T extends SlackResponse>(
  url: string,
  init: RequestInit,
  fetchFn: FetchFn,
): Promise<T> {
  const res = await fetchFn(url, init);
  const body = await res.text();

  let parsed: T;
  try {
    parsed = JSON.parse(body) as T;
  } catch {
    throw new SlackError(
      body.trim() ? `slack returned a non-JSON response (HTTP ${res.status})` : `HTTP ${res.status}`,
    );
  }

  if (!parsed.ok) throw new SlackError(parsed.error ?? `HTTP ${res.status}`);
  return parsed;
}

function post(url: string, token: string, payload: unknown, fetchFn: FetchFn): Promise<SlackResponse> {
  return call(
    url,
    {
      method: 'POST',
      headers: { ...authHeader(token), 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    },
    fetchFn,
  );
}

/** Who the token belongs to. Used to prove a token works before storing it. */
export async function authTest(
  token: string,
  fetchFn: FetchFn = fetch,
): Promise<{ team: string; user: string; teamId: string }> {
  const body = await call<SlackResponse & { team?: string; user?: string; team_id?: string }>(
    `${API}/auth.test`,
    { method: 'POST', headers: authHeader(token) },
    fetchFn,
  );
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
export async function lookupUserByEmail(
  token: string,
  email: string,
  fetchFn: FetchFn = fetch,
): Promise<string | null> {
  const url = `${API}/users.lookupByEmail?${new URLSearchParams({ email }).toString()}`;
  try {
    const body = await call<SlackResponse & { user?: { id?: string } }>(
      url,
      { headers: authHeader(token) },
      fetchFn,
    );
    return body.user?.id ?? null;
  } catch (error) {
    if (error instanceof SlackError && error.message === 'users_not_found') return null;
    throw error;
  }
}

/**
 * Post one message.
 *
 * Unfurling is off on both links and media: the message is a dense single line
 * of PR and ClickUp links, and Slack would otherwise stack a preview card under
 * each one and bury the next release.
 */
export async function postMessage(
  token: string,
  channel: string,
  text: string,
  fetchFn: FetchFn = fetch,
): Promise<{ ts: string; channel: string }> {
  const body = (await post(
    `${API}/chat.postMessage`,
    token,
    { channel, text, unfurl_links: false, unfurl_media: false },
    fetchFn,
  )) as SlackResponse & { ts?: string; channel?: string };
  return { ts: body.ts ?? '', channel: body.channel ?? channel };
}

/**
 * Add the bot to a channel.
 *
 * Raises on failure like everything else — the caller decides whether it
 * matters. Setup treats it as best effort, because a private channel cannot be
 * joined this way at all and has to be invited by a human.
 */
export async function joinChannel(token: string, channelId: string, fetchFn: FetchFn = fetch): Promise<void> {
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
export async function findChannelId(
  token: string,
  name: string,
  fetchFn: FetchFn = fetch,
): Promise<string | null> {
  const wanted = name.trim().replace(/^#/, '').toLowerCase();
  let cursor = '';

  // Bounded by Slack's own paging: an empty next_cursor ends it.
  for (;;) {
    const params = new URLSearchParams({
      types: 'public_channel,private_channel',
      limit: PAGE_SIZE,
      exclude_archived: 'true',
    });
    if (cursor) params.set('cursor', cursor);

    const body = await call<
      SlackResponse & {
        channels?: Array<{ id?: string; name?: string }>;
        response_metadata?: { next_cursor?: string };
      }
    >(`${API}/conversations.list?${params.toString()}`, { headers: authHeader(token) }, fetchFn);

    const hit = body.channels?.find((channel) => channel.name?.toLowerCase() === wanted);
    if (hit?.id) return hit.id;

    cursor = body.response_metadata?.next_cursor?.trim() ?? '';
    if (!cursor) return null;
  }
}
