---
title: "API Docs and Type Definitions"
---
## Overview

The public API reference is written as Markdown under `docs/api`, one file per module. A parser reads those files into `electron-api.json`, and `@electron/typescript-definitions` turns that JSON into `electron.d.ts`. A type-check of a sample project then runs against the result.

Sources: [package.json:80](repo://package.json#L80), [script/create-api-json.mjs:8-14](repo://script/create-api-json.mjs#L8-L14)

## From Markdown to JSON

`create-api-json.mjs` calls `parseDocs` on the repository root, in single-package mode, with the Electron version from `get-version`. It does not read the README. The result is written to `electron-api.json`.

Sources: [script/create-api-json.mjs:1-14](repo://script/create-api-json.mjs#L1-L14)

A module page starts with a heading for the module's name and a blockquote for its description. Its `##` sections group members by kind, such as `Events`, and each `###` heading names one member, such as `Event: 'ready'`.

Sources: [docs/api/app.md:1-3](repo://docs/api/app.md#L1-L3), [docs/api/app.md:18-31](repo://docs/api/app.md#L18-L31)

The structures used as parameter and option types live in `docs/api/structures`, one file for each. A structure file is a heading with a bullet list, and each bullet gives a field's name, its type, whether it is optional, and its description.

Sources: [docs/api/structures/base-window-options.md:1-9](repo://docs/api/structures/base-window-options.md#L1-L9)

## History blocks

Each documented change can carry a history block. `docs/api-history.schema.json` defines it as a JSON schema, and its `pr-url` must be a URL of a pull request in the Electron repository. The schema file's own comment says the TypeScript interfaces in the lint script have to change along with it.

Sources: [docs/api-history.schema.json:4-12](repo://docs/api-history.schema.json#L4-L12), [docs/api-history.schema.json:25](repo://docs/api-history.schema.json#L25)

`lint:api-history` checks the files in `docs/api` against this schema and against the breaking-changes file.

Sources: [package.json:78](repo://package.json#L78)

## Generating the definitions

`create-typescript-definitions` runs three steps in order: it creates `electron-api.json`, it passes that file to `electron-typescript-definitions`, and it runs the type-check of the sample project. `gn-typescript-definitions` runs the same steps and then copies `electron.d.ts` with `script/cp.mjs`.

Sources: [package.json:80-81](repo://package.json#L80-L81)

The npm package installs the definitions it gets from the zip. `npm/install.js` moves `electron.d.ts` from the unpacked distribution to the package root, when the zip contains one.

Sources: [npm/install.js:78-86](repo://npm/install.js#L78-L86)

## Internal typings

The `typings` directory holds declarations that Electron's own code compiles against. `internal-electron.d.ts` references the public `electron.d.ts` and adds the internal `ProcessType` enum to the `Electron` namespace. `internal-ambient.d.ts` declares the `BUILDFLAG` function and the internal Node module types.

Sources: [typings/internal-electron.d.ts:1-9](repo://typings/internal-electron.d.ts#L1-L9), [typings/internal-ambient.d.ts:1-10](repo://typings/internal-ambient.d.ts#L1-L10)

The TypeScript build and the webpack build both list these two files as inputs, so a change to them rebuilds the JavaScript layer. The build steps are covered in [[Bundling the JavaScript Layer]].

Sources: [build/tsc.gni:25-26](repo://build/tsc.gni#L25-L26), [build/webpack/webpack.gni:21-22](repo://build/webpack/webpack.gni#L21-L22)

## Checks on the definitions

`spec/ts-smoke/runner.js` runs `tsc` on `spec/ts-smoke/tsconfig.json`, and it exits with the compiler's status when that fails. This is the type-check that `create-typescript-definitions` runs last.

Sources: [spec/ts-smoke/runner.js:1-17](repo://spec/ts-smoke/runner.js#L1-L17), [package.json:80](repo://package.json#L80)

`spec/types-spec.ts` checks one dependency rule: the `@types/node` range in `npm/package.json` must be a caret range whose major version matches the Node.js that runs the spec.

Sources: [spec/types-spec.ts:3-9](repo://spec/types-spec.ts#L3-L9)
