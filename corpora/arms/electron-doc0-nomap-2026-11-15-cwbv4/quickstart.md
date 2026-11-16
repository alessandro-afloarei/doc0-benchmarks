---
title: "Quickstart: Build and Run from Source"
---
## Overview

This page takes a contributor from an empty directory to a running, locally built Electron and a passing test run. Electron is built inside a full Chromium checkout with GN and ninja, so the first sync and build are large; Electron's separate Build Tools project automates the same steps, and the manual route is described here. What each GN target does is covered in [[Build System]], and how the test runner works in [[Testing]].

Sources: [docs/development/build-instructions-gn.md:1-21](repo://docs/development/build-instructions-gn.md#L1-L21)

## Prerequisites

Install `depot_tools`, Chromium's toolset for fetching Chromium and its dependencies, plus the platform prerequisites in the macOS, Linux or Windows build instructions. On Windows, set `DEPOT_TOOLS_WIN_TOOLCHAIN=0` so `depot_tools` uses the locally installed Visual Studio instead of trying to download a Google-internal toolchain. If you will check out Electron more than once, point `GIT_CACHE_PATH` at a shared directory so later `gclient` runs reuse the roughly 16 GB of fetched history.

Sources: [docs/development/build-instructions-gn.md:7-57](repo://docs/development/build-instructions-gn.md#L7-L57)

## Get the code

`gclient` checks out this repository as `src/electron` and then fetches every dependency named in its `DEPS` file, Chromium and Node.js included, applying Electron's patches on the way (see [[Patching Chromium and Node.js]]).

Sources: [docs/development/build-instructions-gn.md:59-66](repo://docs/development/build-instructions-gn.md#L59-L66), [docs/development/build-instructions-gn.md:86-89](repo://docs/development/build-instructions-gn.md#L86-L89)

```sh
$ mkdir electron && cd electron
$ gclient config --name "src/electron" --unmanaged https://github.com/electron/electron
$ gclient sync --with_branch_heads --with_tags
# This will take a while, go get a coffee.
```

Sources: [docs/development/build-instructions-gn.md:59-66](repo://docs/development/build-instructions-gn.md#L59-L66)

After pulling new commits in `src/electron`, run `gclient sync -f` so the dependencies match `DEPS` again. If an interrupted sync leaves a cryptic rebase conflict, abort the half-applied `git am` in `src` and sync again.

Sources: [docs/development/build-instructions-gn.md:86-97](repo://docs/development/build-instructions-gn.md#L86-L97), [docs/development/build-instructions-gn.md:291-307](repo://docs/development/build-instructions-gn.md#L291-L307)

## Build

From `src`, export `CHROMIUM_BUILDTOOLS_PATH`, generate an output directory from one of the argument presets in `build/args`, and build the `electron` target:

Sources: [docs/development/build-instructions-gn.md:99-128](repo://docs/development/build-instructions-gn.md#L99-L128), [docs/development/build-instructions-gn.md:163-170](repo://docs/development/build-instructions-gn.md#L163-L170)

```sh
$ cd src
$ export CHROMIUM_BUILDTOOLS_PATH=`pwd`/buildtools
$ gn gen out/Testing --args="import(\"//electron/build/args/testing.gn\")"
$ ninja -C out/Testing electron
```

Sources: [docs/development/build-instructions-gn.md:99-170](repo://docs/development/build-instructions-gn.md#L99-L170)

Use `build/args/release.gn` and `out/Release` for a release configuration. To change arguments later, run `gn args out/Testing` instead of regenerating; `gn args out/Testing --list` prints every option. The first build compiles Chromium's content layer, Blink and V8 as well as Electron, so it takes a long time.

Sources: [docs/development/build-instructions-gn.md:140-180](repo://docs/development/build-instructions-gn.md#L140-L180)

| Goal | Command |
| --- | --- |
| Distributable zip | `ninja -C out/Release electron:electron_dist_zip` |
| Node headers for native test modules | `ninja -C out/Testing electron:node_headers` |
| Cross-compile, e.g. x86 from x64 | `gn gen out/Testing-x86 --args='... target_cpu = "x86"'` |

Sources: [docs/development/build-instructions-gn.md:192-208](repo://docs/development/build-instructions-gn.md#L192-L208), [docs/development/build-instructions-gn.md:245-255](repo://docs/development/build-instructions-gn.md#L245-L255)

## Run it

The executable lands in the output directory: `out/Testing/Electron.app/Contents/MacOS/Electron` on macOS, `out/Testing/electron.exe` on Windows and `out/Testing/electron` on Linux. `npm start` runs `script/start.js`, which finds that executable, spawns it with the arguments you pass, and forwards `SIGINT`, `SIGTERM` and `SIGUSR2` to it. `npm run repl` is the same with `--interactive`.

Sources: [docs/development/build-instructions-gn.md:182-190](repo://docs/development/build-instructions-gn.md#L182-L190), [script/start.js:1-19](repo://script/start.js#L1-L19), [package.json:90-92](repo://package.json#L90-L92)

The scripts locate the build through `getOutDir`: `ELECTRON_OUT_DIR` if set (it must exist under `out/`), otherwise the first of `Testing`, `Release`, `Default` or `Debug` that exists. Name your output directory one of those, or set the variable.

Sources: [script/lib/utils.js:15-62](repo://script/lib/utils.js#L15-L62)

Started without an app, Electron runs the bundled default app. It accepts an app folder, a JavaScript file, an `.html` file or an `http:`, `https:`, `file:` or `chrome:` URL, and a few flags:

Sources: [default_app/main.ts:253-266](repo://default_app/main.ts#L253-L266), [default_app/main.ts:276-292](repo://default_app/main.ts#L276-L292)

```sh
$ npm start -- path/to/my-app      # run an app folder
$ npm start -- https://example.com # open a URL in a window
$ npm start -- --interactive       # main-process REPL (not on Windows)
$ npm start -- --version           # print the Electron version
$ npm start -- --abi               # print the Node ABI version
```

Sources: [default_app/main.ts:35-65](repo://default_app/main.ts#L35-L65), [default_app/main.ts:253-298](repo://default_app/main.ts#L253-L298)

With no argument at all it prints its usage and opens its own `index.html` welcome page; how Electron finds and starts an app is described in [[Main Process Bootstrap]].

Sources: [default_app/main.ts:275-298](repo://default_app/main.ts#L275-L298)

## Test

`npm test` runs `script/spec-runner.js`; its `pretest` hook first regenerates the TypeScript definitions. Pass a mocha grep to run a subset, and extra Electron flags for debugging:

Sources: [package.json:87-92](repo://package.json#L87-L92), [docs/development/testing.md:31-37](repo://docs/development/testing.md#L31-L37)

```sh
$ npm run test -- -g ipc
$ npm run test -- --enable-logging -g 'BrowserWindow module'
```

Sources: [package.json:87-92](repo://package.json#L87-L92), [docs/development/testing.md:22-37](repo://docs/development/testing.md#L22-L37), [docs/development/build-instructions-gn.md:257-264](repo://docs/development/build-instructions-gn.md#L257-L264)

If you changed how Node.js is embedded, also run Node's own suite against Electron's Node with `node script/node-spec-runner.js`, optionally naming a single test such as `parallel/test-crypto-keygen`. Before committing, `npm run lint` runs the JavaScript, C++, Python, GN and docs linters; many of them also run as pre-commit hooks.

Sources: [docs/development/testing.md:13-20](repo://docs/development/testing.md#L13-L20), [docs/development/testing.md:39-58](repo://docs/development/testing.md#L39-L58), [package.json:64-85](repo://package.json#L64-L85)
