/**
 * In --json mode stdout is a data channel. Every human line — log.info, error
 * boxes, the status board, a muted note deep inside promote — is moved to
 * stderr here, once, at the command boundary, rather than threading a flag
 * through every print. Machine output is written with process.stdout.write,
 * which this leaves alone.
 */

import { format } from 'util';

export function routeHumanOutputToStderr(): void {
  const toStderr = (...args: unknown[]): void => {
    process.stderr.write(`${format(...args)}\n`);
  };
  console.log = toStderr;
  console.info = toStderr;
  console.warn = toStderr;
}
