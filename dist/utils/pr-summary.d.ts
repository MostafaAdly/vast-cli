/**
 * A two-or-three word name for each PR, the way a teammate would say it in
 * Slack: "guest token reuse", not "fix: reuse guest tokens without overriding
 * customer sessions".
 *
 * The local `claude` CLI does this well and a regex does it badly, so the
 * model is asked first, once for the whole release, and a deterministic
 * heuristic covers every PR it did not answer usably. Nothing here throws: a
 * clumsy phrase costs the announcement some polish, never the announcement.
 *
 * SECURITY: PR titles and branch names are untrusted — anyone who can open a
 * PR writes them, and the phrase lands in a channel the whole team reads. As
 * in summarize.ts, the data is fenced in the prompt and every phrase the model
 * returns is screened before use.
 */
export interface SummaryDeps {
    available: () => boolean;
    run: (prompt: string) => string;
}
interface PrForSummary {
    number: number;
    title: string;
    branch: string;
}
/**
 * The deterministic fallback: the title's leading noun phrase, per part.
 *
 * It cannot paraphrase — "recover from updated orders" becomes "updated
 * orders", not "stale order recovery" — but it is always short, always
 * reproducible, and never says anything the title did not.
 */
export declare function heuristicSummary(title: string): string;
export declare function buildSummaryPrompt(prs: PrForSummary[]): string;
/** A model phrase, or null if it is anything but a short plain phrase. */
export declare function screenSummary(s: string): string | null;
export declare function summarizePrs(prs: PrForSummary[], deps?: SummaryDeps): Promise<Record<number, string>>;
export {};
//# sourceMappingURL=pr-summary.d.ts.map