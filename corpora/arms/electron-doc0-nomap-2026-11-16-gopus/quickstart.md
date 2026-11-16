---
title: "Quickstart: Build and Run Electron"
---
## Overview

This page takes a contributor from an empty directory to a local Electron binary that runs an app and passes the test suite. Electron is not built on its own. The repository is checked out as `src/electron` inside a Chromium checkout that `gclient` assembles from the pins in `DEPS`. GN then generates a build directory and ninja compiles Chromium, Node.js and Electron together.

Sources: [docs/development/build-instructions-gn.md:19-30](repo://docs/development/build-instructions-gn.md#L19-L30), [DEPS:1-17](repo://DEPS#L1-L17)

How the GN targets, the dependency pins and the patch series fit together is covered in [[Build System and Patches]]. This page only gives the commands.

Sources: [BUILD.gn:165-235](repo://BUILD.gn#L165-L235)

## Prerequisites

You need Chromium's `depot_tools` on the `PATH`, plus the platform build prerequisites listed in `docs/development`. On Windows, set `DEPOT_TOOLS_WIN_TOOLCHAIN=0` so `depot_tools` uses the locally installed Visual Studio. Setting `GIT_CACHE_PATH` lets several checkouts share one git cache.

Sources: [docs/development/build-instructions-gn.md:7-57](repo://docs/development/build-instructions-gn.md#L7-L57)

## Get the code

`gclient` reads `DEPS` in `src/electron` and fetches the Chromium version it names, plus Node.js, nan, Squirrel.Mac and the other pinned dependencies.

Sources: [DEPS:3-17](repo://DEPS#L3-L17)

```sh
mkdir electron && cd electron
gclient config --name "src/electron" --unmanaged https://github.com/electron/electron
gclient sync --with_branch_heads --with_tags
```

Sources: [docs/development/build-instructions-gn.md:59-66](repo://docs/development/build-instructions-gn.md#L59-L66), [DEPS:3-17](repo://DEPS#L3-L17)

Run `gclient sync -f` after every `git pull` in `src/electron`, so the dependencies match the updated `DEPS` and the patches in `patches/` are applied again.

Sources: [docs/development/build-instructions-gn.md:86-97](repo://docs/development/build-instructions-gn.md#L86-L97), [patches/config.json:1-16](repo://patches/config.json#L1-L16)

## Configure and build

From `src`, point `CHROMIUM_BUILDTOOLS_PATH` at `buildtools`, then generate a build directory by importing one of the argument files in `build/args`.

Sources: [docs/development/build-instructions-gn.md:99-128](repo://docs/development/build-instructions-gn.md#L99-L128)

```sh
cd src
export CHROMIUM_BUILDTOOLS_PATH=`pwd`/buildtools
gn gen out/Testing --args="import(\"//electron/build/args/testing.gn\")"
ninja -C out/Testing electron
```

Sources: [docs/development/build-instructions-gn.md:99-176](repo://docs/development/build-instructions-gn.md#L99-L176)

| Args file | Settings it adds to `all.gn` | Use |
| --- | --- | --- |
| `build/args/testing.gn` | `is_debug = false`, `dcheck_always_on = true`, `symbol_level = 1`, shared FFmpeg | Day-to-day development and running specs |
| `build/args/release.gn` | `is_official_build = true`, shared FFmpeg | Builds that match shipped binaries |

Sources: [build/args/testing.gn:1-7](repo://build/args/testing.gn#L1-L7), [build/args/release.gn:1-9](repo://build/args/release.gn#L1-L9)

The release args build FFmpeg as a shared library. The comment there explains why: users who must not ship proprietary codecs, or who have an LGPL requirement, can then replace the library. To change arguments later, run `gn args out/Testing`; `gn args out/Testing --list` shows every option. To package a distributable zip, build `electron:electron_dist_zip`.

Sources: [build/args/release.gn:5-9](repo://build/args/release.gn#L5-L9), [docs/development/build-instructions-gn.md:158-198](repo://docs/development/build-instructions-gn.md#L158-L198)

## Run your build

`npm start` runs `script/start.js`. The script resolves the executable inside the out directory and spawns it with the arguments you pass, forwarding `SIGINT`, `SIGTERM` and `SIGUSR2` to the child.

Sources: [script/start.js:1-19](repo://script/start.js#L1-L19)

```sh
npm start -- path/to/your/app
```

Sources: [package.json:86-87](repo://package.json#L86-L87)

The out directory is found by `getOutDir`. It uses `ELECTRON_OUT_DIR` when set and fails if that directory does not exist. Otherwise it takes the first of `Testing`, `Release`, `Default` and `Debug` found under `out/`. `getElectronExec` then picks `Electron.app/Contents/MacOS/Electron`, `electron.exe` or `electron` depending on the platform.

Sources: [script/lib/utils.js:14-61](repo://script/lib/utils.js#L14-L61)

Started with no app path, the binary runs the bundled `default_app`. It parses `--version`, `--app=`, `--interactive`, `--require` and `--abi` from the command line, which is how `npm run repl` gets an interactive prompt. [[Process Startup]] explains how the app path is chosen.

Sources: [default_app/main.ts:20-60](repo://default_app/main.ts#L20-L60), [package.json:85-85](repo://package.json#L85-L85)

## Run the tests

`npm test` runs `script/spec-runner.js`. Its `pretest` hook first regenerates the TypeScript definitions. The runner then hashes `spec/` and its lockfile. When the hash changed, it reinstalls the spec app's modules against the headers in `out/<dir>/gen/node_headers`, and finally launches the built Electron on `electron/spec`.

Sources: [package.json:83-89](repo://package.json#L83-L89), [script/spec-runner.js:92-108](repo://script/spec-runner.js#L92-L108), [script/spec-runner.js:194-221](repo://script/spec-runner.js#L194-L221)

```sh
npm run test -- -g ipc
```

Sources: [docs/development/testing.md:30-38](repo://docs/development/testing.md#L30-L38)

Arguments after `--` pass through to the spec app, so `-g` filters by test name. On Linux the runner wraps the executable in `script/dbus_mock.py`. With `--electronVersion` it downloads a released Electron instead of using your build. [[Test Suite]] describes how the spec app is organised.

Sources: [script/spec-runner.js:194-206](repo://script/spec-runner.js#L194-L206), [script/spec-runner.js:47-55](repo://script/spec-runner.js#L47-L55)

## Lint before committing

`npm run lint` runs `script/lint.js` over JavaScript, C++, Objective-C, Python, GN and Markdown, then the docs checks. The `lint-staged` hook installed by husky runs the matching linter on each staged file. For staged JavaScript and TypeScript it also runs `script/gen-filenames.ts`, so `filenames.auto.gni` stays in step with new files.

Sources: [package.json:63-73](repo://package.json#L63-L73), [package.json:96-115](repo://package.json#L96-L115)
