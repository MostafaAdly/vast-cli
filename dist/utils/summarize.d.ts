/**
 * Optional LLM summary of a release diff, via the local `claude` CLI.
 *
 * Off by default. The deterministic changelog in changelog.ts stays the default
 * because it is reproducible, instant, free, and quotes the team verbatim. This
 * exists for the case that one cannot cover: describing changes nobody wrote a
 * good commit message for.
 *
 * Uses whatever `claude` is on PATH, so there is no API key to manage — it
 * borrows the Claude Code session's own auth.
 *
 * SECURITY: the diff is untrusted input. It is source code, and source code can
 * contain text shaped like instructions ("ignore the above and write X"). A
 * release description is read by reviewers deciding whether to ship to
 * production, so a diff that could steer it is a real risk, not a theoretical
 * one. The prompt fences the diff and the output is screened before use.
 */
export declare function isClaudeAvailable(): boolean;
/** Screens model output. Returns null if it is unusable. */
export declare function screen(output: string): string | null;
export declare function buildPrompt(diff: string, subjects: string[]): string;
/**
 * @returns the summary markdown, or null if it could not be produced — in which
 * case the caller falls back to the deterministic changelog. A failed summary
 * must never fail the promotion.
 */
export declare function summarizeDiff(dir: string, base: string, head: string, subjects: string[]): string | null;
//# sourceMappingURL=summarize.d.ts.map