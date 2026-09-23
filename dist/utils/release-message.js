/**
 * The one-line Slack announcement for a release.
 *
 * The shape is the team's, not this tool's — it is the post they already write
 * by hand, as one Slack bullet:
 *
 *   • <pr|App - hotfix/2.1.15> - ELM single charge, Apple Pay layout (@Mostafa Adly, @Osama Elshimy) (VA-13091, VA-13085)
 *
 * It is produced twice: as `text`, the mrkdwn line Slack shows in the
 * notification and in any client that cannot draw blocks, and as `blocks`, a
 * rich_text list so the channel sees a real bullet with real mentions rather
 * than a typed "•".
 *
 * Everything here is pure: it is handed the PRs, their summaries and the
 * resolved mentions and returns the message. Nothing in this file talks to
 * GitHub, Slack, git or a model, which is why the exact wording can be pinned in
 * tests.
 */
import { parseSubject, tidy } from './changelog.js';
import { clickupTaskUrl } from '../config/slack.js';
import { contributorKey, mergeContributors } from './contributors.js';
/**
 * Ticket ids as the team writes them: ClickUp's own `CU-` ids and the `VA-`
 * custom ids used across the Vast lists. Matched case-insensitively because
 * branch names are usually lowercase, and reported uppercase because that is
 * how ClickUp shows them.
 */
const TICKET = /\b(?:VA-\d+|CU-[a-z0-9]+)\b/gi;
/**
 * Most commit subjects to name before the line stops being readable. Only the
 * subject fallback is capped: a PR summary is two or three words, so even a
 * large hotfix stays one readable line, and the hand-written post names every
 * PR.
 */
const MAX_SUBJECTS = 6;
/**
 * Subjects that describe the pipeline, not the product: merge commits, and the
 * version bumps CI writes on every deploy. Nobody in the channel wants to read
 * them.
 */
function isPipelineNoise(subject) {
    return (/^Merge (pull request|branch|remote-tracking)/i.test(subject) ||
        /^chore:\s*bump version to /i.test(subject) ||
        /^chore:\s*align package\.json version/i.test(subject));
}
export function extractTickets(texts) {
    const seen = [];
    for (const text of texts) {
        for (const match of (text ?? '').matchAll(TICKET)) {
            const id = match[0].toUpperCase();
            if (!seen.includes(id))
                seen.push(id);
        }
    }
    return seen;
}
/**
 * Slack's mrkdwn reserves exactly three characters, and escaping them is the
 * whole of the rule — `&` first, or the escapes would escape each other.
 * Applied to free text in `text` only; link URLs are left alone, and blocks are
 * JSON, where none of this is special.
 */
function escape(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
/** The order everything in the message follows: the order the PRs were opened in. */
function byNumber(prs) {
    return [...prs].sort((a, b) => a.number - b.number);
}
/**
 * Upper-case the first letter of the line and nothing else. The rest is left
 * as written because summaries are mid-sentence phrases ("guest token reuse")
 * next to names that carry their own casing ("ELM", "Apple Pay"). A first word
 * with an interior capital ("iOS") is left alone, as `tidy` does.
 */
function capitaliseFirst(text) {
    if (!/^[a-z]/.test(text))
        return text;
    if (/[A-Z]/.test(text.split(' ')[0]))
        return text;
    return text[0].toUpperCase() + text.slice(1);
}
/**
 * What shipped, in one phrase.
 *
 * Each PR contributes its summary, falling back to its tidied title when no
 * summary came back. Only when there are no PRs at all do commit subjects stand
 * in. A change that appears twice — the same fix opened against two branches,
 * say — is named once.
 */
export function describe(prs, summaries, fallbackSubjects) {
    const items = [];
    const push = (text) => {
        const clean = text.replace(/\s+/g, ' ').trim();
        if (clean && !items.some((i) => i.toLowerCase() === clean.toLowerCase()))
            items.push(clean);
    };
    if (prs.length > 0) {
        for (const pr of byNumber(prs))
            push(summaries[pr.number] ?? tidy(parseSubject(pr.title).text));
        return capitaliseFirst(items.join(', '));
    }
    for (const subject of fallbackSubjects) {
        if (!isPipelineNoise(subject.trim()))
            push(tidy(subject));
    }
    const kept = items.slice(0, MAX_SUBJECTS);
    if (items.length > MAX_SUBJECTS)
        kept.push('…');
    return capitaliseFirst(kept.join(', '));
}
/** Everyone who worked on the release — authors and committers — once each, in PR order. */
export function releaseContributors(prs) {
    return mergeContributors(byNumber(prs).map((pr) => pr.contributors));
}
function people(prs, mentions) {
    return releaseContributors(prs).map((c) => {
        const id = mentions[contributorKey(c)];
        return id ? { userId: id } : { plain: `@${c.name.trim() || c.login || ''}` };
    });
}
/**
 * Branches carry the ticket id even when nobody wrote it in a title, which is
 * how most of these get found. PR by PR, so the tickets read in the same order
 * as the summaries.
 */
function tickets(prs, fallbackSubjects) {
    return extractTickets([...byNumber(prs).flatMap((pr) => [pr.branch, pr.title]), ...fallbackSubjects]);
}
/** `items` with a ", " text element between each pair, as the list is typed by hand. */
function commaSeparated(items) {
    return items.flatMap((item, i) => (i === 0 ? [item] : [{ type: 'text', text: ', ' }, item]));
}
export function buildReleaseMessage(input) {
    const label = `${input.displayName} - ${input.branch}`;
    const description = describe(input.prs, input.summaries, input.fallbackSubjects);
    const named = people(input.prs, input.mentions);
    const ids = tickets(input.prs, input.fallbackSubjects);
    const parts = [`• <${input.prUrl}|${escape(label)}> - ${escape(description)}`];
    if (named.length > 0) {
        parts.push(`(${named.map((p) => ('userId' in p ? `<@${p.userId}>` : escape(p.plain))).join(', ')})`);
    }
    if (ids.length > 0) {
        parts.push(`(${ids.map((id) => `<${clickupTaskUrl(id)}|${id}>`).join(', ')})`);
    }
    const elements = [
        { type: 'link', url: input.prUrl, text: label },
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
    const blocks = [
        {
            type: 'rich_text',
            elements: [
                {
                    type: 'rich_text_list',
                    style: 'bullet',
                    elements: [{ type: 'rich_text_section', elements }],
                },
            ],
        },
    ];
    return { text: parts.join(' '), blocks };
}
//# sourceMappingURL=release-message.js.map