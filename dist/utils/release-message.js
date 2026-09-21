/**
 * The one-line Slack announcement for a release.
 *
 * The shape is the team's, not this tool's — it is what they already post by
 * hand:
 *
 *   • <pr|App - release/2.1.25> - What changed (@author) (<clickup|VA-12755>)
 *
 * Everything here is pure: it is handed the PRs and the resolved mentions and
 * returns a string. Nothing in this file talks to GitHub, Slack or git, which
 * is why the exact wording can be pinned in tests.
 */
import { parseSubject, tidy } from './changelog.js';
import { clickupTaskUrl } from '../config/slack.js';
/**
 * Ticket ids as the team writes them: ClickUp's own `CU-` ids and the `VA-`
 * custom ids used across the Vast lists. Matched case-insensitively because
 * branch names are usually lowercase, and reported uppercase because that is
 * how ClickUp shows them.
 */
const TICKET = /\b(?:VA-\d+|CU-[a-z0-9]+)\b/gi;
/** Most changes to name in one line before it stops being readable. */
const MAX_ITEMS = 6;
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
 * Applied to free text only; link URLs are left alone.
 */
function escape(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function joinCapped(items) {
    const kept = items.slice(0, MAX_ITEMS);
    if (items.length > MAX_ITEMS)
        kept.push('…');
    return kept.join(', ');
}
/**
 * What shipped, in one phrase.
 *
 * PR titles come first because they were written to be read by the team; the
 * conventional-commit prefix is dropped because "feat(dashboard):" is noise in
 * a sentence. A change that appears twice — the same fix opened against two
 * branches, say — is named once.
 */
export function describe(prs, fallbackSubjects) {
    const items = [];
    const push = (text) => {
        const clean = text.trim();
        if (clean && !items.includes(clean))
            items.push(clean);
    };
    if (prs.length > 0) {
        for (const pr of prs)
            push(tidy(parseSubject(pr.title).text));
    }
    else {
        for (const subject of fallbackSubjects)
            push(tidy(subject));
    }
    return joinCapped(items);
}
/**
 * Who to thank.
 *
 * A resolved Slack id becomes a real mention; anyone Slack could not match is
 * named in plain text instead, because a release note that silently drops an
 * author is worse than one that cannot ping them. Each person appears once, in
 * the order their work appears.
 */
function authors(prs, mentions) {
    const out = [];
    const seen = new Set();
    for (const pr of prs) {
        const login = pr.authorLogin.trim();
        if (!login || seen.has(login))
            continue;
        seen.add(login);
        const id = mentions[login];
        out.push(id ? `<@${id}>` : `@${escape(pr.authorName.trim() || login)}`);
    }
    return out;
}
export function buildReleaseMessage(input) {
    const label = escape(`${input.displayName} - ${input.branch}`);
    const parts = [`• <${input.prUrl}|${label}> - ${escape(describe(input.prs, input.fallbackSubjects))}`];
    const people = authors(input.prs, input.mentions);
    if (people.length > 0)
        parts.push(`(${people.join(', ')})`);
    // Branches carry the ticket id even when nobody wrote it in a title, which is
    // how most of these get found.
    const tickets = extractTickets([
        ...input.prs.map((pr) => pr.title),
        ...input.prs.map((pr) => pr.branch),
        ...input.fallbackSubjects,
    ]);
    if (tickets.length > 0) {
        parts.push(`(${tickets.map((id) => `<${clickupTaskUrl(id)}|${id}>`).join(', ')})`);
    }
    return parts.join(' ');
}
//# sourceMappingURL=release-message.js.map