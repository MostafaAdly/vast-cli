/**
 * Turning a thrown error into what a person reads (all of it, on stderr) and
 * what a stream carries (one line of it).
 */

import chalk from 'chalk';
import { log } from './ui.js';

/** The error's message, or the thrown value as text when it is not an Error. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The first non-empty line. A failed `git push` throws "Command failed: …"
 * followed by git's whole stderr; an event's `detail` keeps only the headline.
 */
export function firstLine(text: string): string {
  return text.split('\n').find((line) => line.trim() !== '')?.trim() ?? text.trim();
}

/**
 * What the CLI prints for an error nothing else caught, always on stderr. One
 * function, so the global handler and a --json stream that catches a throw to
 * end itself cleanly print exactly the same lines.
 */
export function reportUnexpectedError(error: unknown): void {
  console.error();
  log.error('An unexpected error occurred:');
  if (error instanceof Error) {
    console.error(chalk.red(`  ${error.message}`));
    if (process.argv.includes('--verbose') && error.stack) {
      console.error();
      console.error(chalk.gray(error.stack));
    }
  } else {
    console.error(chalk.red(`  ${String(error)}`));
  }
}
