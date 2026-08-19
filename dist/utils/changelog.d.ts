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
interface Parsed {
    type: string | null;
    scope: string | null;
    text: string;
}
export declare function parseSubject(subject: string): Parsed;
/** Sentence-case a bullet without mangling acronyms or identifiers. */
export declare function tidy(text: string): string;
export declare function buildChangelog(subjects: string[]): string;
/** Commit subjects on `head` that `base` does not have, newest first. */
export declare function commitSubjects(dir: string, base: string, head: string): string[];
/** Files changed and insertion/deletion counts, for a one-line footer. */
export declare function diffStat(dir: string, base: string, head: string): string | null;
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
export declare function releaseBody(dir: string, base: string, head: string, mode: BodyMode, opts?: {
    selective?: boolean;
}): string;
export {};
//# sourceMappingURL=changelog.d.ts.map