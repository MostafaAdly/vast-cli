import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SlackError,
  authTest,
  findChannelId,
  joinChannel,
  lookupUserByEmail,
  postMessage,
} from '../src/utils/slack.js';

/**
 * The client is only ever handed a fake fetch. The suite never reaches
 * slack.com: a real call would need a real bot token and would post a real
 * message into a real channel.
 */
interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

type Reply = unknown | ((call: Call) => unknown);

function fakeFetch(replies: Reply[]): { fetchFn: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries((init?.headers ?? {}) as Record<string, string>)) {
      headers[key.toLowerCase()] = value;
    }
    const call: Call = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers,
      body: typeof init?.body === 'string' ? init.body : null,
    };
    calls.push(call);
    const reply = replies[Math.min(calls.length - 1, replies.length - 1)];
    const payload = typeof reply === 'function' ? (reply as (c: Call) => unknown)(call) : reply;
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

test('authTest returns the workspace and the bot identity', async () => {
  const { fetchFn, calls } = fakeFetch([
    { ok: true, team: 'Vast Group', user: 'vast-release', team_id: 'T123' },
  ]);

  const who = await authTest('xoxb-abc', fetchFn);
  assert.deepEqual(who, { team: 'Vast Group', user: 'vast-release', teamId: 'T123' });

  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].url, 'https://slack.com/api/auth.test');
  assert.equal(calls[0].headers.authorization, 'Bearer xoxb-abc');
});

test('authTest throws SlackError carrying Slack’s own error string', async () => {
  const { fetchFn } = fakeFetch([{ ok: false, error: 'invalid_auth' }]);
  await assert.rejects(
    () => authTest('xoxb-bad', fetchFn),
    (error: Error) => {
      assert.ok(error instanceof SlackError);
      assert.equal(error.message, 'invalid_auth');
      // The token must never leak into an error message.
      assert.doesNotMatch(error.message, /xoxb/);
      return true;
    },
  );
});

test('lookupUserByEmail returns the member id when Slack knows the address', async () => {
  const { fetchFn, calls } = fakeFetch([{ ok: true, user: { id: 'U0MOSTAFA' } }]);

  const id = await lookupUserByEmail('xoxb-abc', 'mostafa@vastgroup.co', fetchFn);
  assert.equal(id, 'U0MOSTAFA');
  assert.equal(calls[0].method, 'GET');
  assert.match(calls[0].url, /^https:\/\/slack\.com\/api\/users\.lookupByEmail\?/);
  assert.match(calls[0].url, /email=mostafa%40vastgroup\.co/);
  assert.equal(calls[0].headers.authorization, 'Bearer xoxb-abc');
});

test('lookupUserByEmail returns null for users_not_found, which is an answer', async () => {
  const { fetchFn } = fakeFetch([{ ok: false, error: 'users_not_found' }]);
  assert.equal(await lookupUserByEmail('xoxb-abc', 'nobody@example.com', fetchFn), null);
});

test('lookupUserByEmail throws on any other Slack error', async () => {
  const { fetchFn } = fakeFetch([{ ok: false, error: 'missing_scope' }]);
  await assert.rejects(
    () => lookupUserByEmail('xoxb-abc', 'a@b.co', fetchFn),
    (error: Error) => error instanceof SlackError && error.message === 'missing_scope',
  );
});

test('postMessage posts the text as JSON with unfurling off', async () => {
  const { fetchFn, calls } = fakeFetch([{ ok: true, ts: '1700000000.000100', channel: 'C123' }]);

  const sent = await postMessage('xoxb-abc', 'C123', '• hello', fetchFn);
  assert.deepEqual(sent, { ts: '1700000000.000100', channel: 'C123' });

  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].url, 'https://slack.com/api/chat.postMessage');
  assert.equal(calls[0].headers['content-type'], 'application/json');
  assert.equal(calls[0].headers.authorization, 'Bearer xoxb-abc');
  assert.deepEqual(JSON.parse(calls[0].body ?? '{}'), {
    channel: 'C123',
    text: '• hello',
    unfurl_links: false,
    unfurl_media: false,
  });
});

// The blocks carry the real bullet and mentions; text stays in the body because
// it is what the notification and any client that cannot render blocks shows.
test('postMessage sends blocks alongside the text when given them', async () => {
  const { fetchFn, calls } = fakeFetch([{ ok: true, ts: '1.2', channel: 'C123' }]);
  const blocks = [{ type: 'rich_text', elements: [] }];

  await postMessage('xoxb-abc', 'C123', '• hello', fetchFn, blocks);

  assert.deepEqual(JSON.parse(calls[0].body ?? '{}'), {
    channel: 'C123',
    text: '• hello',
    blocks,
    unfurl_links: false,
    unfurl_media: false,
  });
});

test('postMessage surfaces not_in_channel as a SlackError', async () => {
  const { fetchFn } = fakeFetch([{ ok: false, error: 'not_in_channel' }]);
  await assert.rejects(
    () => postMessage('xoxb-abc', 'C123', 'hi', fetchFn),
    (error: Error) => error instanceof SlackError && error.message === 'not_in_channel',
  );
});

test('joinChannel posts the channel id and is quiet on success', async () => {
  const { fetchFn, calls } = fakeFetch([{ ok: true }]);
  await joinChannel('xoxb-abc', 'C123', fetchFn);
  assert.equal(calls[0].url, 'https://slack.com/api/conversations.join');
  assert.equal(calls[0].method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].body ?? '{}'), { channel: 'C123' });
});

test('joinChannel raises the Slack error so the caller can decide to ignore it', async () => {
  const { fetchFn } = fakeFetch([{ ok: false, error: 'method_not_supported_for_channel_type' }]);
  await assert.rejects(
    () => joinChannel('xoxb-abc', 'C123', fetchFn),
    (error: Error) => error instanceof SlackError,
  );
});

test('findChannelId asks for public and private channels', async () => {
  const { fetchFn, calls } = fakeFetch([
    { ok: true, channels: [{ id: 'C1', name: 'releases' }], response_metadata: { next_cursor: '' } },
  ]);

  assert.equal(await findChannelId('xoxb-abc', 'releases', fetchFn), 'C1');
  assert.match(calls[0].url, /^https:\/\/slack\.com\/api\/conversations\.list\?/);
  assert.match(calls[0].url, /types=public_channel%2Cprivate_channel/);
  assert.match(calls[0].url, /limit=1000/);
  assert.equal(calls[0].method, 'GET');
});

test('findChannelId accepts a name written with a leading #', async () => {
  const { fetchFn } = fakeFetch([
    { ok: true, channels: [{ id: 'C1', name: 'releases' }], response_metadata: { next_cursor: '' } },
  ]);
  assert.equal(await findChannelId('xoxb-abc', '#releases', fetchFn), 'C1');
});

test('findChannelId follows the cursor to the page the channel is on', async () => {
  const { fetchFn, calls } = fakeFetch([
    { ok: true, channels: [{ id: 'C1', name: 'general' }], response_metadata: { next_cursor: 'page-2' } },
    { ok: true, channels: [{ id: 'C9', name: 'releases' }], response_metadata: { next_cursor: '' } },
  ]);

  assert.equal(await findChannelId('xoxb-abc', 'releases', fetchFn), 'C9');
  assert.equal(calls.length, 2);
  assert.doesNotMatch(calls[0].url, /cursor=/);
  assert.match(calls[1].url, /cursor=page-2/);
});

test('findChannelId returns null when no page holds the channel', async () => {
  const { fetchFn } = fakeFetch([
    { ok: true, channels: [{ id: 'C1', name: 'general' }], response_metadata: { next_cursor: '' } },
  ]);
  assert.equal(await findChannelId('xoxb-abc', 'releases', fetchFn), null);
});

test('findChannelId raises a Slack error such as a missing scope', async () => {
  const { fetchFn } = fakeFetch([{ ok: false, error: 'missing_scope' }]);
  await assert.rejects(
    () => findChannelId('xoxb-abc', 'releases', fetchFn),
    (error: Error) => error instanceof SlackError && error.message === 'missing_scope',
  );
});

// --- channels may be given by id as well as by name ---
test('isChannelId recognises Slack channel ids and nothing else', async () => {
  const { isChannelId } = await import('../src/utils/slack.js');
  assert.equal(isChannelId('C0123ABCDEF'), true);
  assert.equal(isChannelId('G0123ABCDEF'), true);
  assert.equal(isChannelId(' c0123abcdef '), false, 'ids are upper-case');
  assert.equal(isChannelId('#releases'), false);
  assert.equal(isChannelId('releases'), false);
  assert.equal(isChannelId('Cshort'), false);
});

test('channelInfo resolves an id to its name through conversations.info', async () => {
  const { channelInfo } = await import('../src/utils/slack.js');
  const urls: string[] = [];
  const fetchFn = (async (url: string | URL | Request) => {
    urls.push(String(url));
    return new Response(JSON.stringify({ ok: true, channel: { id: 'C0123ABCDEF', name: 'releases', is_private: false } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  assert.deepEqual(await channelInfo('tok', 'C0123ABCDEF', fetchFn), { id: 'C0123ABCDEF', name: 'releases', isDm: false });
  assert.match(urls[0], /conversations\.info\?channel=C0123ABCDEF$/);
});

test('channelInfo answers null for an unknown id and raises for anything else', async () => {
  const { channelInfo, SlackError } = await import('../src/utils/slack.js');
  const notFound = (async () => new Response(JSON.stringify({ ok: false, error: 'channel_not_found' }), { status: 200 })) as typeof fetch;
  assert.equal(await channelInfo('tok', 'C0123ABCDEF', notFound), null);
  const scope = (async () => new Response(JSON.stringify({ ok: false, error: 'missing_scope' }), { status: 200 })) as typeof fetch;
  await assert.rejects(() => channelInfo('tok', 'C0123ABCDEF', scope), SlackError);
});

// A D… id is a direct message. It has no name, and the bot cannot "join" it;
// setup has to know which kind it got.
test('channelInfo marks a direct message and gives it a readable name', async () => {
  const { channelInfo } = await import('../src/utils/slack.js');
  const fetchFn = (async () =>
    new Response(JSON.stringify({ ok: true, channel: { id: 'D09M387S812', is_im: true, user: 'U1' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
  assert.deepEqual(await channelInfo('tok', 'D09M387S812', fetchFn), {
    id: 'D09M387S812',
    name: 'direct message',
    isDm: true,
  });
});

test('channelInfo reports a channel as not a direct message', async () => {
  const { channelInfo } = await import('../src/utils/slack.js');
  const fetchFn = (async () =>
    new Response(JSON.stringify({ ok: true, channel: { id: 'C0123ABCDEF', name: 'releases' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
  assert.deepEqual(await channelInfo('tok', 'C0123ABCDEF', fetchFn), { id: 'C0123ABCDEF', name: 'releases', isDm: false });
});
