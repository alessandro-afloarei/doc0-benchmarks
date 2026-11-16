---
title: "API Documentation and Typings"
---
## Overview

The public API is written as Markdown in `docs/api/`, and the TypeScript definitions that apps import are generated from that Markdown. The Markdown is the source of truth: a method, event or option exists in the typings only if it has a section in a doc file. This page follows the three steps from a doc file to `electron.d.ts`, then covers the checks that keep the docs valid. The native implementation of each documented module is in [[Main Process Modules]].

Sources: [docs/development/creating-api.md:37-40](repo://docs/development/creating-api.md#L37-L40)

## Source Markdown

Each module has a file in `docs/api/`, such as `app.md`. The file starts with the module name as an `h1`, a one-line summary in a blockquote, and the process the module runs in. Its `h2` sections group the items by kind, such as `Events`, `Methods` and `Properties` in `app.md`, and each event or method has its own `h3` heading.

Sources: [docs/api/app.md:1-5](repo://docs/api/app.md#L1-L5)

Sources: [docs/api/app.md:18-31](repo://docs/api/app.md#L18-L31)

Shared object shapes, such as `Cookie` or `Display`, are kept in `docs/api/structures/`, one file per object, and referenced by name from the module pages.

Sources: [docs/api/structures/cookie.md:1-5](repo://docs/api/structures/cookie.md#L1-L5)

## Generating the JSON

`script/create-api-json.mjs` calls the `@electron/docs-parser` package on the repository root in single-package mode. The parser reads the Markdown and returns one object describing every module, which the script writes to `electron-api.json`. The module version comes from `getElectronVersion`, which reads `override_electron_version` from the build's `args.gn` when it is set.

Sources: [script/create-api-json.mjs:1-17](repo://script/create-api-json.mjs#L1-L17)

Sources: [script/lib/get-version.js:1-25](repo://script/lib/get-version.js#L1-L25)

## Generating the declarations

The `create-typescript-definitions` npm script runs three steps in order. It creates `electron-api.json`, then runs `electron-typescript-definitions` on that file to write `electron.d.ts`, then runs a type-check of the smoke tests against the result.

Sources: [package.json:79-80](repo://package.json#L79-L80)

In the GN build, the `build_electron_definitions` action runs the `gn-typescript-definitions` script and writes the declarations into the generated folder. The webpack browser bundle depends on that action, as described in [[JavaScript Bundles]].

Sources: [BUILD.gn:157-163](repo://BUILD.gn#L157-L163)

The internal declarations that Electron's own code uses are written by hand in `typings/`. `internal-electron.d.ts` adds to the `Electron` namespace the members that are not documented, such as `setAppPath` and the private client certificate handler on `App`. These are not generated, so they are not visible to apps.

Sources: [typings/internal-electron.d.ts:1-20](repo://typings/internal-electron.d.ts#L1-L20)

## History blocks

Each documented change can carry a history block that records the pull request, the breaking-change heading and a short description. The JSON schema for those blocks requires `pr-url` to match a GitHub pull request on the electron organisation, and caps the description at 120 characters.

Sources: [docs/api-history.schema.json:1-30](repo://docs/api-history.schema.json#L1-L30)

The migration guide explains how to find the history of an existing API, from the breaking-changes document, the release notes and `git blame`, and then add the block.

Sources: [docs/development/api-history-migration-guide.md:1-20](repo://docs/development/api-history-migration-guide.md#L1-L20)

## Checks

The documentation lint, `lint:docs`, runs the whole pipeline: it formats the Markdown with remark, generates the typings, type-checks the Markdown code samples, checks links, and runs the history check. The history check uses the schema above and the breaking-changes file.

Sources: [package.json:72-78](repo://package.json#L72-L78)

`spec/ts-smoke/runner.js` runs the TypeScript compiler on the smoke-test project in `spec/ts-smoke/`. That project imports `electron.d.ts` for the main, renderer and utility processes, so a bad declaration fails the type check.

Sources: [spec/ts-smoke/runner.js:1-18](repo://spec/ts-smoke/runner.js#L1-L18)

The `pretest` script runs `create-typescript-definitions` before `npm test`, so the test suite uses declarations generated from the current docs.

Sources: [package.json:86-88](repo://package.json#L86-L88)
