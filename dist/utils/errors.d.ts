/**
 * Turning a thrown error into what a person reads (all of it, on stderr) and
 * what a stream carries (one line of it).
 */
/** The error's message, or the thrown value as text when it is not an Error. */
export declare function errorMessage(error: unknown): string;
/**
 * The first non-empty line. A failed `git push` throws "Command failed: …"
 * followed by git's whole stderr; an event's `detail` keeps only the headline.
 */
export declare function firstLine(text: string): string;
/**
 * What the CLI prints for an error nothing else caught, always on stderr. One
 * function, so the global handler and a --json stream that catches a throw to
 * end itself cleanly print exactly the same lines.
 */
export declare function reportUnexpectedError(error: unknown): void;
//# sourceMappingURL=errors.d.ts.map