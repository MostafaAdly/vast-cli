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
/**
 * Slack's mrkdwn reserves exactly three characters — `&` first, or the escapes
 * would escape each other. Free text in `text` only; blocks are JSON.
 */
export function escapeMrkdwn(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
/** `items` with a ", " text element between each pair, as the list is typed by hand. */
function commaSeparated(items) {
    return items.flatMap((item, i) => (i === 0 ? [item] : [{ type: 'text', text: ', ' }, item]));
}
export function bullet(input) {
    const { url, label, description, people: named, tickets: ids } = input;
    const parts = [`• <${url}|${escapeMrkdwn(label)}> - ${escapeMrkdwn(description)}`];
    if (named.length > 0) {
        parts.push(`(${named.map((p) => ('userId' in p ? `<@${p.userId}>` : escapeMrkdwn(p.plain))).join(', ')})`);
    }
    if (ids.length > 0) {
        parts.push(`(${ids.map((id) => `<${clickupTaskUrl(id)}|${id}>`).join(', ')})`);
    }
    const elements = [
        { type: 'link', url, text: label },
        { type: 'text', text: ` - ${description}${named.length > 0 ? ' (' : ''}` },
    ];
    if (named.length > 0) {
        elements.push(...commaSeparated(named.map((p) => ('userId' in p ? { type: 'user', user_id: p.userId } : { type: 'text', text: p.plain }))));
        elements.push({ type: 'text', text: ids.length > 0 ? ') (' : ')' });
    }
    else if (ids.length > 0) {
        elements.push({ type: 'text', text: ' (' });
    }
    if (ids.length > 0) {
        elements.push(...commaSeparated(ids.map((id) => ({ type: 'link', url: clickupTaskUrl(id), text: id }))));
        elements.push({ type: 'text', text: ')' });
    }
    return { text: parts.join(' '), elements };
}
export function bulletBlocks(bullets, heading) {
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
//# sourceMappingURL=slack-rich-text.js.map