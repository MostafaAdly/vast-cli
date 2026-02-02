/**
 * Terminal UI utilities
 *
 * Provides consistent styling, colors, spinners, and formatting
 * for all CLI output. Uses Chalk for colors and Ora for loading states.
 */
import { type Ora } from 'ora';
/** Create a styled header for command output */
export declare function createHeader(title: string, subtitle?: string): string;
/** Create a success message box */
export declare function createSuccessBox(message: string, details?: string): string;
/** Create an error message box */
export declare function createErrorBox(message: string, details?: string): string;
/** Create an info box */
export declare function createInfoBox(title: string, items: string[]): string;
/** Create a spinner with consistent styling */
export declare function createSpinner(text: string): Ora;
/** Log levels for different message types - direct output */
export declare const log: {
    /** Standard info message */
    info: (message: string) => void;
    /** Success message */
    success: (message: string) => void;
    /** Warning message */
    warn: (message: string) => void;
    /** Error message */
    error: (message: string) => void;
    /** Muted/secondary info - for use as string */
    muted: (message: string) => string;
    /** Highlighted/important info */
    highlight: (message: string) => void;
    /** Primary brand color */
    primary: (message: string) => void;
    /** New line */
    newline: () => void;
};
/** Format a list of items with bullets */
export declare function formatList(items: string[]): string;
/** Format a key-value pair */
export declare function formatKeyValue(key: string, value: string): string;
/** Create a table-like output */
export declare function formatTable(headers: string[], rows: string[][], options?: {
    colWidths?: number[];
}): string;
//# sourceMappingURL=ui.d.ts.map