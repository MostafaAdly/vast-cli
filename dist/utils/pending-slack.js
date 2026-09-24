/**
 * The pending list as one Slack message: a bold heading, then one bullet per
 * repo in the team's announcement shape, linking GitHub's compare view.
 * Only what the target still lacks is posted — the reverse direction is a
 * question for whoever runs the report, not news for the channel.
 */
import { describe, extractTickets, namedPeople } from './release-message.js';
import { bullet, bulletBlocks } from './slack-rich-text.js';
import { prsOf } from './pending-report.js';
import { mergeContributors } from './contributors.js';
function asShipped(p) {
    return { number: p.number, title: p.title, url: p.url, branch: p.branch, contributors: p.contributors };
}
/** Everyone behind the forward list, once each — the people the post may mention. */
export function pendingContributors(report) {
    return mergeContributors(report.repos.flatMap((r) => (r.forward ? prsOf(r.forward).map((p) => p.contributors) : [])));
}
export function buildPendingSlack(report, mentions) {
    const bullets = [];
    for (const r of report.repos) {
        const f = r.forward;
        if (!f)
            continue;
        const prs = prsOf(f).sort((a, b) => a.number - b.number);
        if (prs.length === 0 && f.direct.length === 0)
            continue;
        const shipped = prs.map(asShipped);
        const phrases = {};
        for (const p of prs)
            if (p.phrase)
                phrases[p.number] = p.phrase;
        bullets.push(bullet({
            url: r.compareUrl,
            label: `${r.displayName} - ${f.source} → ${f.target}`,
            description: describe(shipped, phrases, f.direct.map((c) => c.subject)),
            people: namedPeople(shipped, mentions),
            tickets: extractTickets(prs.flatMap((p) => p.tickets)),
        }));
    }
    if (bullets.length === 0)
        return null;
    const heading = `Pending for ${report.to}`;
    return { text: [`*${heading}*`, ...bullets.map((b) => b.text)].join('\n'), blocks: bulletBlocks(bullets, heading) };
}
//# sourceMappingURL=pending-slack.js.map