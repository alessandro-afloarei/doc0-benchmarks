---
title: "Quickstart"
---
## Overview

A contributor works in this repository in two ways: building Electron from source with GN and Ninja, and using the npm `electron` package, which only downloads a prebuilt binary. The source build produces an executable under `out/`, and the repository's scripts start that executable and run the spec suite against it. The npm package locates its binary through a `path.txt` file written at install time.

Sources: [script/lib/utils.js:15-27](repo://script/lib/utils.js#L15-L27), [npm/install.js:73-91](repo://npm/install.js#L73-L91), [npm/index.js:4-19](repo://npm/index.js#L4-L19)

## Build from source

The source build runs inside a Chromium checkout that contains this repository as `src/electron`. Create the checkout with `gclient`, then sync it.

Sources: [docs/development/build-instructions-gn.md:50-64](repo://docs/development/build-instructions-gn.md#L50-L64)

1. Configure the checkout: run `gclient config --name "src/electron" --unmanaged https://github.com/electron/electron`, then `gclient sync --with_branch_heads --with_tags`.
2. Sync again with `gclient sync -f` after the `DEPS` file changes.
3. Generate a build directory: `gn gen out/Testing --args="import(\"//electron/build/args/testing.gn\")"`. Use `build/args/release.gn` for a release build; [[Build System]] explains what the argument files set.
4. Build the binary: `ninja -C out/Testing electron`.

Sources: [docs/development/build-instructions-gn.md:63-64](repo://docs/development/build-instructions-gn.md#L63-L64), [docs/development/build-instructions-gn.md:96](repo://docs/development/build-instructions-gn.md#L96), [docs/development/build-instructions-gn.md:127](repo://docs/development/build-instructions-gn.md#L127), [docs/development/build-instructions-gn.md:145](repo://docs/development/build-instructions-gn.md#L145), [docs/development/build-instructions-gn.md:169](repo://docs/development/build-instructions-gn.md#L169)

The output directory name is the only link between the `gn gen` step and the scripts: `getElectronExec` builds the path to `out/<dir>/electron` on Linux from the directory it finds with `getOutDir`.

Sources: [script/lib/utils.js:15-23](repo://script/lib/utils.js#L15-L23)

## Start the built app

`npm start` runs `script/start.js`, which launches the binary found by `getAbsoluteElectronExec` and passes every remaining argument to it. The child inherits stdio, and the wrapper forwards `SIGINT`, `SIGTERM` and `SIGUSR2` to it, so Ctrl-C reaches the app.

Sources: [package.json:91](repo://package.json#L91), [script/start.js:1-8](repo://script/start.js#L1-L8), [script/start.js:10-19](repo://script/start.js#L10-L19), [script/lib/utils.js:60-62](repo://script/lib/utils.js#L60-L62)

## Run the specs

`npm test` runs `script/spec-runner.js`. Its runner map holds one runner, `main`, whose description is "Main process specs" and whose run function calls `runTestUsingElectron('spec', 'main')`. The runner parses `--runners` and `--target` flags with `minimist`, then spawns the built executable with the runner arguments.

Sources: [package.json:92](repo://package.json#L92), [script/spec-runner.js:22-25](repo://script/spec-runner.js#L22-L25), [script/spec-runner.js:42-44](repo://script/spec-runner.js#L42-L44), [script/spec-runner.js:164-166](repo://script/spec-runner.js#L164-L166), [script/spec-runner.js:220-222](repo://script/spec-runner.js#L220-L222)

The runner's `main` entry resolves the built executable and passes it the `electron/spec` argument. On Linux the spawn runs `python3` on `script/dbus_mock.py` with the executable as its first argument. The suite's layout is explained on [[Testing with the Spec Suite]].

Sources: [script/spec-runner.js:194-206](repo://script/spec-runner.js#L194-L206)

## Use the npm package

Installing the `electron` package runs `npm/install.js`, which skips the download when `ELECTRON_SKIP_BINARY_DOWNLOAD` is set. Otherwise it fetches the artifact for the current platform unless a matching `dist/version` already exists, unzips it into `dist/`, and writes `path.txt` with the executable's relative path. `npm/index.js` reads that file and exports the absolute path, which is what `require('electron')` returns in a Node script.

Sources: [npm/install.js:9-11](repo://npm/install.js#L9-L11), [npm/install.js:61-70](repo://npm/install.js#L61-L70), [npm/install.js:73-91](repo://npm/install.js#L73-L91), [npm/index.js:4-19](repo://npm/index.js#L4-L19)

Platform names map to executable paths in `getPlatformPath`: `Electron.app` on macOS, `electron` on Linux and BSD, and `electron.exe` on Windows. Any other platform throws.

Sources: [npm/install.js:93-109](repo://npm/install.js#L93-L109)

