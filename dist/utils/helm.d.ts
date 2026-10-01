/**
 * Parses the deployed image tag out of a Vast-deployments values file.
 *
 * Both environments' files come from Vast-deployments over the API (see
 * `utils/deployments.ts`); this module is only the parser. Nothing reads an app
 * repo's own `Helm/` directory any more: its values stopped moving when the
 * pipelines took over, so reading it would report a stale version.
 */
/** First uncommented `tag:` value in a values file. */
export declare function extractTag(yaml: string): string;
//# sourceMappingURL=helm.d.ts.map