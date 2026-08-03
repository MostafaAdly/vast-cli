/**
 * Best-effort notification via the vast-routines notifier (Telegram).
 *
 * notify.sh reads the message from stdin — never argv, deliberately, so the bot
 * token can never end up in a process listing. Never throws: a failed
 * notification must not fail a deploy that already succeeded.
 */

import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const NOTIFY_SH = join(homedir(), '.claude', 'vast-routines', 'bugfixer', 'notify.sh');

export function notify(message: string): void {
  if (!existsSync(NOTIFY_SH)) return;
  try {
    execFileSync('bash', [NOTIFY_SH], {
      input: message,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 20000,
    });
  } catch {
    // Deliberately silent.
  }
}
