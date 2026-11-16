---
title: "Build and Package Exports"
---
## Overview

The package is built by one script, `build/build.ts`, which emits three things: an ES module tree in `dist`, a CommonJS tree in `dist/cjs`, and declaration files in `dist/types`. Every TypeScript file under `src` becomes its own entry point, so the module layout is also the export layout. Two checks keep the two export maps honest: `validate-exports` compares `package.json` with `jsr.json`, and `publint` checks the built package. This page covers the build steps, the export checks, and what a contributor changes to add an entry point. The test suites are on [[Test Suites]].

Sources: [build/build.ts:18-39](repo://build/build.ts#L18-L39), [build/build.ts:103-107](repo://build/build.ts#L103-L107)

## Entry points

The build collects every `src/**/*.ts` file, except test files, `src/mod.ts`, `src/middleware.ts` and anything under `src/deno`, and uses each one as an esbuild entry point. The ESM build bundles each entry with its dependencies, and the CommonJS build keeps the files separate, so each file has a `.js` counterpart in both trees.

Sources: [build/build.ts:28-39](repo://build/build.ts#L28-L39), [build/build.ts:72-92](repo://build/build.ts#L72-L92)

Imports in the ESM output are rewritten to include `.js`, and a directory import gets `/index.js`. The plugin decides this by checking whether a `.ts` file exists at the import path, and marks the import as external, so esbuild keeps the path as written.

Sources: [build/build.ts:41-70](repo://build/build.ts#L41-L70)

## Build steps

The script first reads the `exports` maps of `package.json` and `jsr.json`, and checks each map against the other. Then it runs the ESM build, the CommonJS build and `tsc` for the declarations, in parallel. In watch mode the two esbuild runs use watch contexts, and the same script passes `-w` to `tsc`.

Sources: [build/build.ts:18-26](repo://build/build.ts#L18-L26), [build/build.ts:94-107](repo://build/build.ts#L94-L107)

After `tsc` writes the declarations, every `.d.ts` file under `dist/types` is passed to `removePrivateFields`. That step replaces the text of each `#private` class field in those declaration files with spaces, so the positions of the remaining text stay the same.

Sources: [build/build.ts:109-114](repo://build/build.ts#L109-L114), [build/remove-private-fields.ts:27-57](repo://build/remove-private-fields.ts#L27-L57)

## Export checks

`validateExports(source, target, fileName)` checks that every entry in the source map has a matching entry in the target map. A match is an exact key, or a wildcard key such as `./utils/*` that covers it. The error names the missing entry and the file that lacks it. The build calls this in both directions, so the two maps must list the same entries.

Sources: [build/validate-exports.ts:1-37](repo://build/validate-exports.ts#L1-L37), [build/build.ts:24-26](repo://build/build.ts#L24-L26)

`package.json` maps each subpath to three files: the declaration, the ES module and the CommonJS module, under `dist`. `jsr.json` maps the same subpaths to the TypeScript sources. The two must agree on the set of subpaths, which is why the check runs.

Sources: [package.json:38-50](repo://package.json#L38-L50), [jsr.json:8-20](repo://jsr.json#L8-L20)

The root `package.json` sets `main`, `module` and `types` to the root entry. Its `postbuild` script runs `publint` on the built package. The CommonJS output gets a `package.json` with `"type": "commonjs"`, so Node reads those files as CommonJS.

Sources: [package.json:5-8](repo://package.json#L5-L8), [package.json:29-31](repo://package.json#L29-L31), [package.cjs.json:1-3](repo://package.cjs.json#L1-L3)

## Adding an entry point

A new subpath needs a file under `src` and a line in each export map. The build picks up the file on its own, but `validateExports` fails the build if the two maps differ. A contributor adds the subpath to `package.json` with the three targets, and to `jsr.json` with the source path, then runs `bun run build`, which runs the checks.

Sources: [build/build.ts:18-26](repo://build/build.ts#L18-L26), [package.json:38-50](repo://package.json#L38-L50), [jsr.json:8-12](repo://jsr.json#L8-L12)
