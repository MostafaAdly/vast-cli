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
import { bullet, bulletBlocks } from './slack-rich-text.js';
import { contributorKey, mergeContributors } from './contributors.js';
import { isPipelineNoise } from './pr-subject.js';
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
/**
 * A resolved Slack id becomes a real mention; anyone Slack could not match is
 * named in plain text instead, because a release note that silently drops a
 * person is worse than one that cannot ping them.
 */
export function namedPeople(prs, mentions) {
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
export function buildReleaseMessage(input) {
    const b = bullet({
        url: input.prUrl,
        label: `${input.displayName} - ${input.branch}`,
        description: describe(input.prs, input.summaries, input.fallbackSubjects),
        people: namedPeople(input.prs, input.mentions),
        tickets: tickets(input.prs, input.fallbackSubjects),
    });
    return { text: b.text, blocks: bulletBlocks([b]) };
}
//# sourceMappingURL=release-message.js.map