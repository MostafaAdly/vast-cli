/**
 * Builds a release PR description from the commits being promoted.
 *
 * The body is read by the whole team, most of whom do not use this CLI, so it
 * carries no tool instructions, no branding, and no reference to how it was
 * produced — just what is in the release.
 *
 * Bullets come from commit subjects rather than a summary of the diff: those
 * subjects were written by the people who made the changes, so they are both
 * accurate and already in the team's own words.
 */

import { execFileSync } from 'child_process';
import { summarizeDiff } from './summarize.js';

/** Conventional-commit type -> the section it lands in. */
const SECTIONS: Array<{ title: string; types: string[] }> = [
  { title: 'Features', types: ['feat'] },
  { title: 'Fixes', types: ['fix', 'hotfix', 'bugfix'] },
  { title: 'Improvements', types: ['perf', 'refactor', 'style'] },
  { title: 'Maintenance', types: ['chore', 'build', 'ci', 'docs', 'test'] },
];

/** Anything left over. */
const OTHER = 'Other changes';

/** Most bullets to show per section before collapsing the tail into a count. */
const MAX_PER_SECTION = 15;

/**
 * Deploy bookkeeping the CI writes on every release. It describes the pipeline,
 * not the product, so it is noise in a release description.
 */
function isPipelineNoise(subject: string): boolean {
  return (
    /^chore:\s*bump version to /i.test(subject) ||
    /^chore:\s*align package\.json version/i.test(subject) ||
    /^Merge (branch|remote-tracking branch|pull request)/i.test(subject)
  );
}

interface Parsed {
  type: string | null;
  scope: string | null;
  text: string;
}

export function parseSubject(subject: string): Parsed {
  const m = /^([a-z]+)(?:\(([^)]+)\))?!?:\s*(.+)$/i.exec(subject.trim());
  if (!m) return { type: null, scope: null, text: subject.trim() };
  return { type: m[1].toLowerCase(), scope: m[2] ?? null, text: m[3].trim() };
}

/** Sentence-case a bullet without mangling acronyms or identifiers. */
export function tidy(text: string): string {
  // Trim BEFORE stripping the full stop — a trailing space would otherwise
  // keep the period from matching the end anchor.
  const trimmed = text.replace(/\s+/g, ' ').trim().replace(/\.$/, '');
  if (!trimmed) return trimmed;
  if (!/^[a-z]/.test(trimmed)) return trimmed;

  // Leave the first word alone if it carries an interior capital — "iOS",
  // "iPhone", "useOrders" would all be wrecked by a naive uppercase.
  const firstWord = trimmed.split(' ')[0];
  if (/[A-Z]/.test(firstWord)) return trimmed;

  return trimmed[0].toUpperCase() + trimmed.slice(1);
}

export function buildChangelog(subjects: string[]): string {
  const cleaned = subjects.map((s) => s.trim()).filter((s) => s && !isPipelineNoise(s));

  const buckets = new Map<string, string[]>();
  const push = (section: string, bullet: string): void => {
    const list = buckets.get(section) ?? [];
    if (!list.includes(bullet)) list.push(bullet);
    buckets.set(section, list);
  };

  for (const subject of cleaned) {
    const { type, scope, text } = parseSubject(subject);
    const section = SECTIONS.find((s) => type && s.types.includes(type))?.title ?? OTHER;
    push(section, tidy(scope ? `${scope}: ${text}` : text));
  }

  if (buckets.size === 0) return '';

  const order = [...SECTIONS.map((s) => s.title), OTHER];
  const parts: string[] = [];

  for (const title of order) {
    const bullets = buckets.get(title);
    if (!bullets?.length) continue;
    parts.push(`### ${title}`);
    for (const b of bullets.slice(0, MAX_PER_SECTION)) parts.push(`- ${b}`);
    const hidden = bullets.length - MAX_PER_SECTION;
    if (hidden > 0) parts.push(`- _…and ${hidden} more_`);
    parts.push('');
  }

  return parts.join('\n').trimEnd();
}

/** Commit subjects on `head` that `base` does not have, newest first. */
export function commitSubjects(dir: string, base: string, head: string): string[] {
  try {
    const out = execFileSync(
      'git',
      ['log', `${base}..${head}`, '--no-merges', '--pretty=format:%s'],
      { cwd: dir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
    return out.split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

/** Files changed and insertion/deletion counts, for a one-line footer. */
export function diffStat(dir: string, base: string, head: string): string | null {
  try {
    const out = execFileSync('git', ['diff', '--shortstat', `${base}...${head}`], {
      cwd: dir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}

export type BodyMode = 'changelog' | 'summarize' | 'bare';

/**
 * The full PR body.
 *
 * Deliberately contains no instructions for the release manager — the audience
 * is every reviewer on the team, and most of them do not use this tool.
 *
 * `summarize` falls back to `changelog` whenever the model summary cannot be
 * produced or does not pass screening, so the body is never left empty.
 */
export function releaseBody(
  dir: string,
  base: string,
  head: string,
  mode: BodyMode,
  opts: { selective?: boolean } = {},
): string {
  // A selective PR must not claim to promote staging wholesale — reviewers
  // read the heading as the scope of what they are approving.
  const heading = opts.selective
    ? `Promotes selected changes from \`staging\` to \`production\`.`
    : `Promotes \`staging\` to \`production\`.`;
  if (mode === 'bare') return heading;

  const subjects = commitSubjects(dir, base, head);
  const stat = diffStat(dir, base, head);

  let section: string | null = null;
  let title = "What's included";

  if (mode === 'summarize') {
    section = summarizeDiff(dir, base, head, subjects);
    if (section) title = 'Summary';
  }
  if (!section) {
    section = buildChangelog(subjects);
    title = "What's included";
  }

  const parts = [heading, ''];
  if (section) {
    parts.push(`## ${title}`, '', section);
  }
  if (stat) {
    parts.push('', '---', `<sub>${stat}</sub>`);
  }
  return parts.join('\n').trim();
}
