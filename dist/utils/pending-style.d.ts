/**
 * The terminal dress for `vast pending`: colours from the CLI's palette and
 * clickable links, applied only when a person is looking at a terminal.
 *
 * Links use OSC 8, which iTerm2, VS Code, Warp, WezTerm, kitty and GNOME
 * Terminal turn into clickable text. Terminals that do not know it (macOS
 * Terminal.app among them) ignore the escape and show the text as it was, so
 * emitting it is safe; a pipe or a file never gets it at all.
 */
import { type TerminalStyle } from './pending-report.js';
export declare function hyperlink(text: string, url: string): string;
export interface TerminalEnv {
    isTTY: boolean;
    /** NO_COLOR is set: keep the links, drop the colour. */
    noColor: boolean;
    /** chalk's detected colour support, 0 = none. */
    colorLevel: number;
}
export declare function terminalStyle(env?: TerminalEnv): TerminalStyle;
//# sourceMappingURL=pending-style.d.ts.map