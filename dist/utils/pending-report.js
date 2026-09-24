/**
 * `vast pending`: the report model and its renderers.
 *
 * Everything here is pure — a model in, text out — so the exact output of
 * every mode is pinned in tests. Gathering the model (git, gh, the model
 * call) lives in src/commands/pending.ts.
 */
import { clickupTaskUrl } from '../config/slack.js';
import { parseSubject, tidy } from './changelog.js';
import { extractTickets } from './release-message.js';
/** Over two weeks on staging without reaching production is worth a nudge. */
export const STALE_DAYS = 14;
const DAY_MS = 86_400_000;
export function ageDays(landedAt, now) {
    return Math.max(0, Math.floor((now.getTime() - landedAt.getTime()) / DAY_MS));
}
export function prsOf(d) {
    return [...d.inFlight.flatMap((g) => g.prs), ...d.waiting];
}
function itemCount(d) {
    return prsOf(d).length + d.direct.length;
}
function oldestDays(d, now) {
    const ages = [...prsOf(d), ...d.direct].map((i) => ageDays(i.landedAt, now));
    return ages.length > 0 ? Math.max(...ages) : null;
}
function personName(c) {
    return c.name.trim() || c.login || '?';
}
function plural(n, word) {
    return `${n} ${word}${n === 1 ? '' : 's'}`;
}
export function buildDirection(input) {
    const prs = input.side.prs
        .map((unit) => {
        const d = input.details.get(unit.number);
        const branch = d?.branch ?? unit.branch;
        return {
            number: unit.number,
            title: d ? tidy(parseSubject(d.title).text) : branch,
            url: d?.url ?? `${input.repoUrl}/pull/${unit.number}`,
            branch,
            contributors: d?.contributors ?? [],
            tickets: extractTickets([branch, d?.title ?? '']),
            phrase: input.phrases[unit.number] ?? null,
            landedAt: unit.landedAt,
            ported: input.side.ported.has(unit.sha),
            detailsUnavailable: !d,
        };
    })
        .sort((a, b) => a.number - b.number);
    // A PR already inside an open release/hotfix PR is on its way; listing it
    // as merely waiting would invite someone to pick it twice. One carried by
    // several open PRs belongs to the newest: the older one is usually superseded.
    const newestFirst = [...input.openReleases].sort((a, b) => b.number - a.number);
    const claimed = new Set();
    const inFlight = [];
    for (const release of newestFirst) {
        const carried = prs.filter((p) => release.prNumbers.includes(p.number) && !claimed.has(p.number));
        for (const p of carried)
            claimed.add(p.number);
        if (carried.length > 0)
            inFlight.push({ number: release.number, url: release.url, branch: release.branch, prs: carried });
    }
    inFlight.sort((a, b) => a.number - b.number);
    return {
        source: input.source,
        target: input.target,
        inFlight,
        waiting: prs.filter((p) => !claimed.has(p.number)),
        direct: input.side.direct.map((c) => {
            const ported = input.side.ported.has(c.sha);
            const carrier = ported ? undefined : newestFirst.find((r) => r.commits.includes(c.sha));
            return {
                sha: c.sha,
                subject: c.subject,
                landedAt: c.landedAt,
                ported,
                inFlight: carrier ? { number: carrier.number, branch: carrier.branch } : null,
            };
        }),
    };
}
/** Tickets in first-seen order, then an Untracked group; a PR with two tickets appears under both. */
export function groupByTicket(prs) {
    const groups = new Map();
    for (const p of prs) {
        for (const key of p.tickets.length > 0 ? p.tickets : [null]) {
            if (!groups.has(key))
                groups.set(key, []);
            groups.get(key).push(p);
        }
    }
    const out = [...groups.entries()].filter(([k]) => k !== null).map(([ticket, list]) => ({ ticket, prs: list }));
    const untracked = groups.get(null);
    if (untracked)
        out.push({ ticket: null, prs: untracked });
    return out;
}
function markers(item, age, r) {
    const out = [];
    if (item.ported)
        out.push('ported (same code)');
    // Not proof of absence: a port-back that needed conflict fixes has
    // different code, so the wording stays "not found".
    else if (r.role === 'reverse')
        out.push(`⚠ not found on ${r.other}`);
    // Already on its way: how long it waited is no longer the question.
    else if ('inFlight' in item && item.inFlight)
        out.push(`in flight · ${item.inFlight.branch} (#${item.inFlight.number})`);
    else if (age > STALE_DAYS)
        out.push('⚠ stale');
    if ('detailsUnavailable' in item && item.detailsUnavailable)
        out.push('details unavailable');
    return out;
}
function prText(p, short) {
    return !short && p.phrase ? `${p.phrase} — ${p.title}` : p.title;
}
function terminalPr(p, o, r, indent) {
    const age = ageDays(p.landedAt, o.now);
    const meta = [p.contributors.map(personName).join(', '), p.tickets.join(', '), `${age}d`].filter(Boolean).join(' · ');
    const flags = markers(p, age, r).map((m) => `  ${m}`).join('');
    return [`${indent}#${p.number}  ${prText(p, o.short)}`, `${indent}      ${meta}${flags}`];
}
function terminalCommit(c, o, r) {
    const age = ageDays(c.landedAt, o.now);
    return `    ${c.sha.slice(0, 7)}  ${c.subject} · ${age}d${markers(c, age, r).map((m) => `  ${m}`).join('')}`;
}
function terminalPrList(prs, o, r) {
    if (!o.byTicket)
        return prs.flatMap((p) => terminalPr(p, o, r, '    '));
    return groupByTicket(prs).flatMap((g) => [
        `    ${g.ticket ?? 'Untracked'}`,
        ...g.prs.flatMap((p) => terminalPr(p, o, r, '      ')),
    ]);
}
function footer(d, now) {
    const prs = prsOf(d);
    const tickets = new Set(prs.flatMap((p) => p.tickets)).size;
    const parts = [plural(prs.length, 'PR')];
    if (d.direct.length > 0)
        parts.push(plural(d.direct.length, 'direct commit'));
    if (tickets > 0)
        parts.push(plural(tickets, 'ticket'));
    const oldest = oldestDays(d, now);
    if (oldest !== null)
        parts.push(`oldest ${plural(oldest, 'day')}`);
    return parts.join(' · ');
}
function terminalRepo(r, o) {
    if (r.problem || !r.forward)
        return [`  ${r.repo}  ${r.problem?.message ?? ''}`.trimEnd()];
    const f = r.forward;
    const rv = r.reverse;
    const head = `  ${r.repo} | ${f.source} → ${f.target}`;
    if (itemCount(f) === 0 && (!rv || itemCount(rv) === 0))
        return [`${head} · in sync`];
    const lines = [head];
    const section = (title, body) => {
        if (body.length > 0)
            lines.push('', `  ${title}`, ...body);
    };
    const fwd = { role: 'forward', other: f.target };
    for (const g of f.inFlight)
        section(`In flight · ${g.branch} (#${g.number}, open)`, terminalPrList(g.prs, o, fwd));
    section(`Waiting (${f.waiting.length})`, terminalPrList(f.waiting, o, fwd));
    section(`Direct commits (${f.direct.length})`, f.direct.map((c) => terminalCommit(c, o, fwd)));
    lines.push('', itemCount(f) > 0 ? `  ${footer(f, o.now)}` : `  Nothing on ${f.source} that ${f.target} lacks.`);
    if (rv) {
        const back = { role: 'reverse', other: rv.target };
        if (itemCount(rv) === 0)
            lines.push('', `  Nothing on ${rv.source} that ${rv.target} lacks.`);
        else
            section(`On ${rv.source}, not on ${rv.target} (${itemCount(rv)})`, [
                ...terminalPrList(prsOf(rv), o, back),
                ...rv.direct.map((c) => terminalCommit(c, o, back)),
            ]);
    }
    return lines;
}
/**
 * WAITING counts PRs and direct commits alike: both are work the target lacks.
 * A direct commit an open release branch already carries counts as IN FLIGHT.
 */
function sweepTable(report, o) {
    const header = ['REPO', 'WAITING', 'IN FLIGHT', ...(report.parity ? [`${report.to.toUpperCase()} ONLY`] : []), 'OLDEST'];
    const rows = report.repos.map((r) => {
        if (r.problem || !r.forward)
            return [r.repo, r.problem?.message ?? ''];
        const f = r.forward;
        const oldest = oldestDays(f, o.now);
        const directInFlight = f.direct.filter((c) => c.inFlight).length;
        return [
            r.repo,
            String(f.waiting.length + f.direct.length - directInFlight),
            String(f.inFlight.reduce((n, g) => n + g.prs.length, 0) + directInFlight),
            ...(report.parity ? [String(r.reverse ? itemCount(r.reverse) : 0)] : []),
            oldest === null ? '—' : `${oldest}d`,
        ];
    });
    const full = rows.filter((row) => row.length === header.length);
    const widths = header.map((h, i) => Math.max(h.length, ...full.map((row) => row[i].length), ...(i === 0 ? rows.map((row) => row[0].length) : [])));
    const fmt = (row) => row.length === header.length
        ? `  ${row.map((c, i) => (i === row.length - 1 ? c : c.padEnd(widths[i]))).join('  ')}`
        : `  ${row[0].padEnd(widths[0])}  ${row[1]}`;
    return [fmt(header), ...rows.map(fmt)];
}
export function renderTerminal(report, o) {
    const sections = report.repos.map((r) => terminalRepo(r, o).join('\n'));
    const parts = report.repos.length > 1 ? [sweepTable(report, o).join('\n'), ...sections] : sections;
    return parts.join('\n\n');
}
/**
 * Text written by whoever opened a PR or typed a commit, made literal: a title
 * like "Fix <PaymentSheet>" would otherwise vanish as an HTML tag when pasted
 * into GitHub, and "*overlap*" turn italic.
 */
function mdEscape(text) {
    return text.replace(/[\\*_`<>[\]]/g, (c) => `\\${c}`);
}
function mdPr(p, o, r, indent = '') {
    const age = ageDays(p.landedAt, o.now);
    const text = !o.short && p.phrase ? `**${mdEscape(p.phrase)}** — ${mdEscape(p.title)}` : mdEscape(p.title);
    const parts = [`[#${p.number}](${p.url}) ${text}`];
    if (p.contributors.length > 0)
        parts.push(p.contributors.map(personName).join(', '));
    if (p.tickets.length > 0)
        parts.push(p.tickets.map((t) => `[${t}](${clickupTaskUrl(t)})`).join(', '));
    parts.push(`${age}d`, ...markers(p, age, r));
    return `${indent}- ${parts.join(' · ')}`;
}
function mdCommit(c, o, r) {
    const age = ageDays(c.landedAt, o.now);
    return `- \`${c.sha.slice(0, 7)}\` ${mdEscape(c.subject)} · ${[`${age}d`, ...markers(c, age, r)].join(' · ')}`;
}
function mdPrList(prs, o, r) {
    if (!o.byTicket)
        return prs.map((p) => mdPr(p, o, r));
    return groupByTicket(prs).flatMap((g) => [
        `- **${g.ticket ? `[${g.ticket}](${clickupTaskUrl(g.ticket)})` : 'Untracked'}**`,
        ...g.prs.map((p) => mdPr(p, o, r, '  ')),
    ]);
}
function mdRepo(r, o) {
    const title = r.forward ? `## ${r.displayName} — ${r.forward.source} → ${r.forward.target}` : `## ${r.displayName}`;
    if (r.problem || !r.forward)
        return [title, '', `_${r.problem?.message ?? ''}_`];
    const f = r.forward;
    const rv = r.reverse;
    if (itemCount(f) === 0 && (!rv || itemCount(rv) === 0))
        return [title, '', 'In sync.'];
    const lines = [title];
    const section = (heading, body) => {
        if (body.length > 0)
            lines.push('', `### ${heading}`, '', ...body);
    };
    const fwd = { role: 'forward', other: f.target };
    for (const g of f.inFlight)
        section(`In flight · [${g.branch} (#${g.number})](${g.url})`, mdPrList(g.prs, o, fwd));
    section(`Waiting (${f.waiting.length})`, mdPrList(f.waiting, o, fwd));
    section(`Direct commits (${f.direct.length})`, f.direct.map((c) => mdCommit(c, o, fwd)));
    if (itemCount(f) === 0)
        lines.push('', `Nothing on ${f.source} that ${f.target} lacks.`);
    if (rv) {
        const back = { role: 'reverse', other: rv.target };
        if (itemCount(rv) === 0)
            lines.push('', `Nothing on ${rv.source} that ${rv.target} lacks.`);
        else
            section(`On ${rv.source}, not on ${rv.target} (${itemCount(rv)})`, [
                ...mdPrList(prsOf(rv), o, back),
                ...rv.direct.map((c) => mdCommit(c, o, back)),
            ]);
    }
    return lines;
}
/** Ready to paste into a ClickUp doc or a PR description. */
export function renderMarkdown(report, o) {
    return `${report.repos.map((r) => mdRepo(r, o).join('\n')).join('\n\n')}\n`;
}
/** For the /release skill and scripts. Dates serialise as ISO strings. */
export function renderJson(report) {
    return JSON.stringify(report, null, 2);
}
//# sourceMappingURL=pending-report.js.map