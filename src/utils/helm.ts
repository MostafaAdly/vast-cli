/**
 * Parses the deployed image tag out of a values file.
 *
 * The file itself now comes from Vast-deployments over the API (see
 * `utils/deployments.ts`); this module is only the parser.
 */

/** First uncommented `tag:` value in a values file. */
export function extractTag(yaml: string): string {
  for (const line of yaml.split('\n')) {
    const stripped = line.trim();
    if (stripped.startsWith('#')) continue;
    const m = /^tag:\s*["']?([^"'\s#]+)["']?/.exec(stripped);
    if (m) return m[1];
  }
  throw new Error('No `tag:` found in Helm values file');
}
