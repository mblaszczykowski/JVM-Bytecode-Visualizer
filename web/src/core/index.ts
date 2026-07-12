/**
 * Domain layer: the `.class` parser, the disassembler and the interpreter.
 *
 * Pure TypeScript — no React, no DOM, no application layer. The boundary is enforced by
 * `@typescript-eslint/no-restricted-imports` in `eslint.config.js` (ADR-0001); dependencies
 * flow one way only, UI → core.
 *
 * Re-exports the three layer barrels rather than individual symbols, so a new export in a
 * layer reaches the UI without touching this file.
 */
export * from './classfile';
export * from './disassembler';
export * from './interpreter';
