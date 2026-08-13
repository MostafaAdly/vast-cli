#!/usr/bin/env node
/**
 * Bundle entry point.
 *
 * `bin/vast.js` loads `dist/` for local development; this file is what esbuild
 * bundles into the single `build/vast.js` that ships in a GitHub Release. Both
 * do the same two things, but the bundle needs its own entry because esbuild
 * follows TypeScript sources rather than the compiled output.
 */
export {};
//# sourceMappingURL=cli-entry.d.ts.map