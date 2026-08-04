/**
 * Terminal UI utilities
 *
 * Provides consistent styling, colors, spinners, and formatting
 * for all CLI output. Uses Chalk for colors and Ora for loading states.
 */
import { type Ora } from 'ora';
/**
 * Brand colors for Vast CLI
 * Using a consistent color palette across the application
 */
export declare const colors: {
    primary: import("chalk").ChalkInstance;
    success: import("chalk").ChalkInstance;
    warning: import("chalk").ChalkInstance;
    error: import("chalk").ChalkInstance;
    info: import("chalk").ChalkInstance;
    muted: import("chalk").ChalkInstance;
    highlight: import("chalk").ChalkInstance;
};
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
    /**
     * Muted/secondary info.
     *
     * This used to return the string instead of printing it, unlike every other
     * method here — so `log.muted('...')` as a statement silently printed
     * nothing. Use `dim()` when you need the styled string to embed elsewhere.
     */
    muted: (message: string) => void;
    /** Highlighted/important info */
    highlight: (message: string) => void;
    /** Primary brand color */
    primary: (message: string) => void;
    /** New line */
    newline: () => void;
    /** Muted text as a string, for embedding inside another line. */
    dim: (message: string) => string;
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