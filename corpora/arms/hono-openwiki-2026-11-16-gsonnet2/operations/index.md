# Files

- [Build, Exports and Packaging](build-and-packaging.md) - How the Hono package is built (esbuild ESM and CJS plus tsc declarations with private-field stripping), how package.json and jsr.json exports are kept in sync, CI checks, and how to add a new subpath entrypoint.
- [Testing Strategy and Runtime Tests](testing.md) - How Hono is tested - Vitest projects (main, JSX runtimes, per-runtime), the shared router conformance suite, type-level tests, runtime-tests for Bun, Deno, Node, workerd, Fastly and Lambda, coverage thresholds, and commands for focused runs.
