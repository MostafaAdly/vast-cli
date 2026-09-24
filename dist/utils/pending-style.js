/**
 * The terminal dress for `vast pending`: colours from the CLI's palette and
 * clickable links, applied only when a person is looking at a terminal.
 *
 * Links use OSC 8, which iTerm2, VS Code, Warp, WezTerm, kitty and GNOME
 * Terminal turn into clickable text. Terminals that do not know it (macOS
 * Terminal.app among them) ignore the escape and show the text as it was, so
 * emitting it is safe; a pipe or a file never gets it at all.
 */
import chalk, { Chalk } from 'chalk';
import { PLAIN_STYLE } from './pending-report.js';
export function hyperlink(text, url) {
    return `\u001B]8;;${url}\u001B\\${text}\u001B]8;;\u001B\\`;
}
/** The CLI's palette (src/utils/ui.ts), on a chalk the caller controls. */
function palette(c) {
    const primary = c.hex('#6366F1');
    const success = c.hex('#10B981');
    const warning = c.hex('#F59E0B');
    const error = c.hex('#EF4444');
    const info = c.hex('#3B82F6');
    const muted = c.hex('#6B7280');
    const highlight = c.hex('#8B5CF6');
    return {
        repo: primary.bold,
        muted,
        inFlight: info,
        waiting: highlight.bold,
        direct: highlight.bold,
        reverse: warning.bold,
        pr: primary.bold,
        phrase: c.bold,
        ticket: info,
        sha: c.yellow,
        stale: warning,
        ported: success,
        notFound: error,
        error,
        ok: success,
    };
}
export function terminalStyle(env = {
    isTTY: process.stdout.isTTY === true,
    noColor: process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== '',
    colorLevel: chalk.level,
}) {
    if (!env.isTTY)
        return PLAIN_STYLE;
    if (env.noColor || env.colorLevel === 0)
        return { paint: (_tone, text) => text, link: hyperlink };
    const tones = palette(new Chalk({ level: Math.min(3, env.colorLevel) }));
    return { paint: (tone, text) => tones[tone](text), link: hyperlink };
}
//# sourceMappingURL=pending-style.js.map