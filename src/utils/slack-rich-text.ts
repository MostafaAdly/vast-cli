/**
 * The team's Slack bullet: `• <link|label> - description (people) (tickets)`.
 *
 * Produced twice, as the release announcement does: `text`, the mrkdwn line
 * Slack shows in notifications and clients that cannot draw blocks, and
 * `elements`, one rich_text section so the channel sees a real bullet with
 * real mentions. Shared by the release announcement and `vast pending` so the
 * two posts cannot drift apart.
 */

import { clickupTaskUrl } from '../config/slack.js';

export type RichElement =
  | { type: 'link'; url: string; text: string }
  | { type: 'text'; text: string }
  | { type: 'user'; user_id: string };

/** A resolved Slack id becomes a mention; anyone unmatched is named in plain text. */
export type Person = { userId: string } | { plain: string };

export interface Bullet {
  text: string;
  elements: RichElement[];
}

/**
 * Slack's mrkdwn reserves exactly three characters — `&` first, or the escapes
 * would escape each other. Free text in `text` only; blocks are JSON.
 */
export function escapeMrkdwn(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** `items` with a ", " text element between each pair, as the list is typed by hand. */
function commaSeparated(items: RichElement[]): RichElement[] {
  return items.flatMap((item, i) => (i === 0 ? [item] : [{ type: 'text', text: ', ' } as RichElement, item]));
}

export function bullet(input: {
  url: string;
  label: string;
  description: string;
  people: Person[];
  tickets: string[];
}): Bullet {
  const { url, label, description, people: named, tickets: ids } = input;

  const parts = [`• <${url}|${escapeMrkdwn(label)}> - ${escapeMrkdwn(description)}`];
  if (named.length > 0) {
    parts.push(`(${named.map((p) => ('userId' in p ? `<@${p.userId}>` : escapeMrkdwn(p.plain))).join(', ')})`);
  }
  if (ids.length > 0) {
    parts.push(`(${ids.map((id) => `<${clickupTaskUrl(id)}|${id}>`).join(', ')})`);
  }

  const elements: RichElement[] = [
    { type: 'link', url, text: label },
    { type: 'text', text: ` - ${description}${named.length > 0 ? ' (' : ''}` },
  ];
  if (named.length > 0) {
    elements.push(
      ...commaSeparated(
        named.map((p): RichElement => ('userId' in p ? { type: 'user', user_id: p.userId } : { type: 'text', text: p.plain })),
      ),
    );
    elements.push({ type: 'text', text: ids.length > 0 ? ') (' : ')' });
  } else if (ids.length > 0) {
    elements.push({ type: 'text', text: ' (' });
  }
  if (ids.length > 0) {
    elements.push(...commaSeparated(ids.map((id): RichElement => ({ type: 'link', url: clickupTaskUrl(id), text: id }))));
    elements.push({ type: 'text', text: ')' });
  }

  return { text: parts.join(' '), elements };
}

export function bulletBlocks(bullets: Bullet[], heading?: string): unknown[] {
  const list = {
    type: 'rich_text_list',
    style: 'bullet',
    elements: bullets.map((b) => ({ type: 'rich_text_section', elements: b.elements })),
  };
  const elements = heading
    ? [{ type: 'rich_text_section', elements: [{ type: 'text', text: heading, style: { bold: true } }] }, list]
    : [list];
  return [{ type: 'rich_text', elements }];
}
