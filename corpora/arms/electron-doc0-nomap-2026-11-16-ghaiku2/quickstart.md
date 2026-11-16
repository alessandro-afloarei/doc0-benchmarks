---
title: "Quickstart"
---
## Overview

This page gets a local checkout to the two checks a change needs to pass: the lint script and the main-process test suite. Building the native binary is a separate, long step, covered in [[GN Build]]. The commands below run from the repository root, which is the `src/electron` folder of a Chromium checkout.

Sources: [package.json:61-64](repo://package.json#L61-L64)

## Tools

The repository pins Node.js 20 in `.nvmrc`. The dev dependencies in `package.json` include the lint, documentation and test-runner tools, so `npm install` in the root installs what the scripts need.

Sources: [.nvmrc:1-1](repo://.nvmrc#L1-L1)

Sources: [package.json:61-64](repo://package.json#L61-L64)

## Lint

`npm run lint` runs `script/lint.js` and then the documentation checks. The lint script picks linters by file type: C++ files under `shell/` go to clang-format and cpplint, and the other languages have their own entries in the same table.

Sources: [script/lint.js:116-126](repo://script/lint.js#L116-L126)

```sh
npm run lint
npm run lint:js
npm run lint:cpp
```

Sources: [package.json:64-72](repo://package.json#L64-L72)

## Run the tests

The test runner, `npm run test`, runs `script/spec-runner.js`. It needs a built binary in an output folder named `Testing`, `Release`, `Default` or `Debug`, or in the folder named by `ELECTRON_OUT_DIR`. The tests themselves are an Electron app under `spec/`, with its own `package.json`.

Sources: [script/lib/utils.js:31-57](repo://script/lib/utils.js#L31-L57)

```sh
npm run test
npm run test -- -g ipc
```

Sources: [package.json:92-92](repo://package.json#L92-L92)

The `-g` flag takes a regex and runs only the matching specs.

Sources: [docs/development/testing.md:22-38](repo://docs/development/testing.md#L22-L38)

## Before running tests

After a GN build, the test modules must be compiled against the Node.js headers that the build produced. The build guide gives the Ninja target for this step.

Sources: [docs/development/build-instructions-gn.md:244-255](repo://docs/development/build-instructions-gn.md#L244-L255)
