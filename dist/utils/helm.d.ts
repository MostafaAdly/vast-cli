/**
 * Parses the deployed image tag out of a values file.
 *
 * The file itself now comes from Vast-deployments over the API (see
 * `utils/deployments.ts`); this module is only the parser.
 */
/** First uncommented `tag:` value in a values file. */
export declare function extractTag(yaml: string): string;
//# sourceMappingURL=helm.d.ts.map