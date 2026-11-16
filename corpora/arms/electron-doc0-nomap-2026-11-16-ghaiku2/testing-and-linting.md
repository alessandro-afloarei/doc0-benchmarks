---
title: "Testing and Linting"
---
## Overview

The repository checks itself in three ways. The main-process test suite is an Electron app under `spec/`, started by `script/spec-runner.js`. Node.js's own test suite runs on Electron's fork of Node through `script/node-spec-runner.js`, and a native-addon suite runs through `script/nan-spec-runner.js`. Linting is one script, `script/lint.js`, that picks a linter for each kind of file. The commands to run them locally are in [[Quickstart]].

Sources: [script/spec-runner.js:42-44](repo://script/spec-runner.js#L42-L44)

Sources: [docs/development/testing.md:40-47](repo://docs/development/testing.md#L40-L47)

## The main-process suite

`spec-runner.js` has one runner, `main`, and its `run` function starts the built Electron binary on the `spec` folder. On Linux the call goes through `dbus_mock.py`, so the tests get a D-Bus session. A non-zero exit from Electron fails the whole run.

Sources: [script/spec-runner.js:194-208](repo://script/spec-runner.js#L194-L208)

Sources: [script/spec-runner.js:220-222](repo://script/spec-runner.js#L220-L222)

Before each run, the runner hashes `spec/package.json`, `spec/yarn.lock` and its own source file, and compares the hash with the one saved in `spec/.hash`. When the hash differs from the saved one, the runner reinstalls the spec's dependencies and saves the new hash.

Sources: [script/spec-runner.js:265-275](repo://script/spec-runner.js#L265-L275)

Sources: [script/spec-runner.js:121-130](repo://script/spec-runner.js#L121-L130)

`spec/index.js` is the Electron app. It sets the environment before any test loads: it points ts-node at `tsconfig.spec.json`, turns off the security warnings, and adds fake media devices. It keeps the process alive when the first window closes. Then it runs Mocha, with retries and a grep from `MOCHA_GREP` or `--grep`.

Sources: [spec/index.js:1-30](repo://spec/index.js#L1-L30)

Sources: [spec/index.js:64-92](repo://spec/index.js#L64-L92)

## Type definitions before tests

The `pretest` script runs `create-typescript-definitions`, and `spec-runner.js` runs the same step through `generateTypeDefinitions` when `electron.d.ts` is missing. A test run therefore never uses stale declarations.

Sources: [package.json:86-88](repo://package.json#L86-L88)

Sources: [script/spec-runner.js:110-119](repo://script/spec-runner.js#L110-L119)

## Node.js and native-addon suites

`node-spec-runner.js` runs Node.js's own tests from `third_party/electron_node`. It reads `node-disabled-tests.json`, which lists the tests Electron skips, and it can write JUnit output.

Sources: [script/node-spec-runner.js:1-30](repo://script/node-spec-runner.js#L1-L30)

`nan-spec-runner.js` runs the NaN test suite from `third_party/nan`, the same way, so native-addon compatibility is checked against Electron's Node build.

Sources: [script/nan-spec-runner.js:1-14](repo://script/nan-spec-runner.js#L1-L14)

## Linting

`script/lint.js` defines one linter per kind of file. The C++ and Objective-C linters check `shell/` with clang-format and cpplint, the Python and JavaScript linters use their own tools, and `gn` checks the GN files. The `patches` and `md` linters cover the patch files and the Markdown.

Sources: [script/lint.js:116-130](repo://script/lint.js#L116-L130)

Sources: [script/lint.js:144-160](repo://script/lint.js#L144-L160)

Sources: [script/lint.js:174-176](repo://script/lint.js#L174-L176)

Sources: [script/lint.js:202-205](repo://script/lint.js#L202-L205)

Sources: [script/lint.js:283-286](repo://script/lint.js#L283-L286)

With no flag, `lint.js` runs every linter. A flag such as `--js` runs only that linter. When no path is given, the file list is the staged changes from `git diff --cached`.

Sources: [script/lint.js:486-500](repo://script/lint.js#L486-L500)
