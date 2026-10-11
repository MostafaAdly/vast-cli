/**
 * In --json mode stdout is a data channel. Every human line — log.info, error
 * boxes, the status board, a muted note deep inside promote — is moved to
 * stderr here, once, at the command boundary, rather than threading a flag
 * through every print. Machine output is written with process.stdout.write,
 * which this leaves alone.
 */
export declare function routeHumanOutputToStderr(): void;
//# sourceMappingURL=json-mode.d.ts.map