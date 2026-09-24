/**
 * A two-or-three word name for each PR, the way a teammate would say it in
 * Slack: "guest token reuse", not "fix: reuse guest tokens without overriding
 * customer sessions".
 *
 * The local `claude` CLI does this well and a regex does it badly, so the
 * model is asked first — one call per 40 PRs, run side by side — and a
 * deterministic heuristic covers every PR it did not answer usably. Nothing here throws: a
 * clumsy phrase costs the announcement some polish, never the announcement.
 *
 * SECURITY: PR titles and branch names are untrusted — anyone who can open a
 * PR writes them, and the phrase lands in a channel the whole team reads. As
 * in summarize.ts, the data is fenced in the prompt and every phrase the model
 * returns is screened before use.
 */
export interface SummaryDeps {
    available: () => boolean | Promise<boolean>;
    run: (prompt: string) => Promise<string>;
}
export interface PrForSummary {
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
/**
 * The model's phrases alone, screened, with no fallback. A PR the model
 * skipped or answered badly is absent, and an empty result means no usable
 * model phrase — which is how `vast pending` knows to show titles instead of
 * the weaker rule-based phrase.
 */
export declare function modelPhrases(prs: PrForSummary[], deps?: SummaryDeps): Promise<Record<number, string>>;
export declare function summarizePrs(prs: PrForSummary[], deps?: SummaryDeps): Promise<Record<number, string>>;
//# sourceMappingURL=pr-summary.d.ts.map