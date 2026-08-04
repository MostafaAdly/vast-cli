/**
 * Root help screen.
 *
 * Commander's default help is a flat, monochrome list of commands. The thing
 * that is actually hard to learn here is not what each command does — it is
 * which command belongs at which stage of develop -> staging -> production. So
 * the flow leads, commands are grouped by purpose, and worked examples show the
 * version each one derives.
 *
 * Everything below is pure string building except `lockState()`, which reads
 * the production lock so the screen reflects the machine it is run on.
 */
/** Target width. Keeps the screen intact in an 80-column terminal. */
export declare const WIDTH = 76;
interface Row {
    /** Left column — a command name or an example invocation. */
    left: string;
    /** Right column — description or expected outcome. */
    right: string;
}
/** Width of the widest left-hand cell across the given rows, plus a gutter. */
export declare function columnWidth(rows: Row[], gutter?: number): number;
export declare function heading(text: string): string;
/** A command row: violet name, plain description. */
export declare function commandRow(row: Row, width: number): string;
/** An example row: blue invocation, muted outcome. */
export declare function exampleRow(row: Row, width: number): string;
/**
 * The pipeline, with the command that moves you along each hop.
 *
 * Branches escalate in colour left to right — blue, amber, red — because the
 * consequence of a mistake escalates the same way.
 */
export declare function flowDiagram(): string;
/**
 * Live production-lock state.
 *
 * Locked is rendered green: the lock is the protection, so the safe state gets
 * the reassuring colour and the unlocked state gets the one that earns
 * attention. This is deliberately the inverse of the "lock icon = red" instinct.
 */
export declare function lockState(): string;
export declare function renderRootHelp(version: string): string;
export {};
//# sourceMappingURL=help.d.ts.map