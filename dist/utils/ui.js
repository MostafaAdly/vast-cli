/**
 * Terminal UI utilities
 *
 * Provides consistent styling, colors, spinners, and formatting
 * for all CLI output. Uses Chalk for colors and Ora for loading states.
 */
import chalk from 'chalk';
import ora from 'ora';
import boxen from 'boxen';
/**
 * Brand colors for Vast CLI
 * Using a consistent color palette across the application
 */
export const colors = {
    primary: chalk.hex('#6366F1'), // Indigo
    success: chalk.hex('#10B981'), // Emerald
    warning: chalk.hex('#F59E0B'), // Amber
    error: chalk.hex('#EF4444'), // Red
    info: chalk.hex('#3B82F6'), // Blue
    muted: chalk.hex('#6B7280'), // Gray
    highlight: chalk.hex('#8B5CF6'), // Violet
};
/** Create a styled header for command output */
export function createHeader(title, subtitle) {
    const lines = [
        '',
        colors.primary.bold(`  ${title}`),
        subtitle ? colors.muted(`  ${subtitle}`) : '',
        ''
    ].filter(Boolean);
    return lines.join('\n');
}
/** Create a success message box */
export function createSuccessBox(message, details) {
    const content = details
        ? `${colors.success.bold('✓')} ${message}\n\n${colors.muted(details)}`
        : `${colors.success.bold('✓')} ${message}`;
    return boxen(content, {
        padding: 1,
        borderStyle: 'round',
        borderColor: 'green',
        dimBorder: false,
    });
}
/** Create an error message box */
export function createErrorBox(message, details) {
    const content = details
        ? `${colors.error.bold('✗')} ${message}\n\n${colors.muted(details)}`
        : `${colors.error.bold('✗')} ${message}`;
    return boxen(content, {
        padding: 1,
        borderStyle: 'round',
        borderColor: 'red',
        dimBorder: false,
    });
}
/** Create an info box */
export function createInfoBox(title, items) {
    const content = [
        colors.info.bold(`ℹ ${title}`),
        '',
        ...items.map(item => `  ${colors.muted('•')} ${item}`)
    ].join('\n');
    return boxen(content, {
        padding: 1,
        borderStyle: 'round',
        borderColor: 'blue',
        dimBorder: true,
    });
}
/** Create a spinner with consistent styling */
export function createSpinner(text) {
    return ora({
        text: colors.muted(text),
        spinner: 'dots',
        color: 'cyan',
    });
}
/** Log levels for different message types - direct output */
export const log = {
    /** Standard info message */
    info: (message) => { console.log(colors.info(message)); },
    /** Success message */
    success: (message) => { console.log(colors.success(`✓ ${message}`)); },
    /** Warning message */
    warn: (message) => { console.log(colors.warning(`⚠ ${message}`)); },
    /** Error message */
    error: (message) => { console.error(colors.error(`✗ ${message}`)); },
    /**
     * Muted/secondary info.
     *
     * This used to return the string instead of printing it, unlike every other
     * method here — so `log.muted('...')` as a statement silently printed
     * nothing. Use `dim()` when you need the styled string to embed elsewhere.
     */
    muted: (message) => { console.log(colors.muted(message)); },
    /** Highlighted/important info */
    highlight: (message) => { console.log(colors.highlight(message)); },
    /** Primary brand color */
    primary: (message) => { console.log(colors.primary(message)); },
    /** New line */
    newline: () => { console.log(''); },
    /** Muted text as a string, for embedding inside another line. */
    dim: (message) => colors.muted(message),
};
/** Format a list of items with bullets */
export function formatList(items) {
    return items.map(item => `  ${colors.muted('•')} ${item}`).join('\n');
}
/** Format a key-value pair */
export function formatKeyValue(key, value) {
    return `${colors.muted(key)}: ${colors.highlight(value)}`;
}
/** Create a table-like output */
export function formatTable(headers, rows, options) {
    // Simple table formatting - could be enhanced with cli-table3 for complex needs
    const output = [];
    // Headers
    const headerRow = headers.map((h, i) => colors.primary.bold(h.padEnd(options?.colWidths?.[i] ?? 15))).join('  ');
    output.push(headerRow);
    output.push(colors.muted('─'.repeat(headerRow.length)));
    // Rows
    for (const row of rows) {
        const formatted = row.map((cell, i) => cell.padEnd(options?.colWidths?.[i] ?? 15)).join('  ');
        output.push(formatted);
    }
    return output.join('\n');
}
//# sourceMappingURL=ui.js.map