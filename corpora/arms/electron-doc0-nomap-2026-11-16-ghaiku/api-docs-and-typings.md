---
title: "API Docs and TypeScript Types"
---
## Overview

The API reference is Markdown under `docs/api`, and it is also the source of the TypeScript definitions that ship with each release. A script parses those pages into one JSON description of the API, and the `electron-typescript-definitions` generator turns that description into the typings. Lint steps check the pages, the JSON examples in them, and the history blocks that record when each API changed. This page covers that pipeline. The code the definitions describe is on the pages for each area, such as [[Windows and WebContents]].

Sources: [script/create-api-json.mjs:1-14](repo://script/create-api-json.mjs#L1-L14), [package.json:79-80](repo://package.json#L79-L80)

## Parsing the docs

`script/create-api-json.mjs` calls `parseDocs` from `@electron/docs-parser` with the repository root as the base directory. It runs in single-package mode, takes the version from `getElectronVersion`, and writes the result to `electron-api.json` at the repository root. A failure prints the error and exits with status 1.

Sources: [script/create-api-json.mjs:1-14](repo://script/create-api-json.mjs#L1-L14)

`getElectronVersion` reads `override_electron_version` from the `args.gn` file in the output folder when it exists. Otherwise it runs `get-git-version.py` and returns its output. A build that has never run `gn gen` therefore takes its version from git, and the error from a missing `args.gn` is ignored on purpose.

Sources: [script/lib/get-version.js:8-28](repo://script/lib/get-version.js#L8-L28)

The reference pages share one layout. Each page starts with a level-one heading for the module, followed by a blockquote that gives the one-line description, and then the process line, which names the process type. Each event is a level-three heading under `## Events`.

Sources: [docs/api/app.md:1-18](repo://docs/api/app.md#L1-L18), [docs/api/app.md:22-31](repo://docs/api/app.md#L22-L31)

## Generating the definitions

`create-typescript-definitions` runs three steps in order: `create-api-json`, then the `electron-typescript-definitions` binary on `electron-api.json`, then the smoke check. The chain stops at the first failure because each step needs the output of the one before.

Sources: [package.json:80](repo://package.json#L80)

The smoke check runs `tsc` on `spec/ts-smoke/tsconfig.json` and exits with the compiler's status. That check compiles the generated definitions against the sample code in `spec/ts-smoke`, so a definition that does not type-check fails the lint run.

Sources: [spec/ts-smoke/runner.js:1-18](repo://spec/ts-smoke/runner.js#L1-L18)

The internal typings in `typings/` are separate from the generated file. `internal-electron.d.ts` and `internal-ambient.d.ts` declare the types that the code under `lib/` uses, and the webpack bundle build lists them as inputs, so a change to them rebuilds the bundles.

Sources: [build/webpack/webpack.gni:16-23](repo://build/webpack/webpack.gni#L16-L23)

## Lint checks

`lint:docs` runs a fixed sequence. It runs remark over the docs, checks the JavaScript in code blocks with standard, regenerates the definitions and checks the TypeScript examples, lints the fiddle examples, checks relative links, lints the Markdown, and checks API history blocks. The first failure stops the sequence.

Sources: [package.json:72](repo://package.json#L72), [package.json:74-78](repo://package.json#L74-L78)

API history blocks are validated against `docs/api-history.schema.json`. The schema's `$comment` says that a change to it must be matched in the linting script's TypeScript interfaces, and each change record has a `pr-url` that must point at a pull request of this repository.

Sources: [docs/api-history.schema.json:1-12](repo://docs/api-history.schema.json#L1-L12), [package.json:78](repo://package.json#L78)

Structures have their own pages under `docs/api/structures`. A structure page lists each field as a bullet with its type after the name.

Sources: [docs/api/structures/size.md:1-4](repo://docs/api/structures/size.md#L1-L4)

The shipped types therefore follow the docs, and the smoke check tests them against sample code. The code that implements these APIs is compiled by the build steps on [[Build System]].

Sources: [spec/ts-smoke/runner.js:4-15](repo://spec/ts-smoke/runner.js#L4-L15), [package.json:80](repo://package.json#L80)
