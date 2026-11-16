---
title: "Quickstart: Building and Running Electron"
---
## Overview

This page takes a contributor from an empty directory to a running, locally built Electron. Electron is compiled with GN and ninja on top of a Chromium checkout fetched by `gclient`; the commands below are the ones the repository's own build instructions give. For how the build is put together, see [[Build System]]; for the project as a whole, see [[Electron Overview]].

Sources: [docs/development/build-instructions-gn.md:15-30](repo://docs/development/build-instructions-gn.md#L15-L30)

## Get the code

Electron is checked out as `src/electron` inside a gclient workspace. `gclient` reads the `DEPS` file inside that folder to pull Chromium, Node.js and the other dependencies, and `gclient sync -f` re-aligns them after a `git pull`.

```sh
mkdir electron && cd electron
gclient config --name "src/electron" --unmanaged https://github.com/electron/electron
gclient sync --with_branch_heads --with_tags
```

Sources: [docs/development/build-instructions-gn.md:59-66](repo://docs/development/build-instructions-gn.md#L59-L66), [docs/development/build-instructions-gn.md:86-97](repo://docs/development/build-instructions-gn.md#L86-L97)

The platform prerequisites and `depot_tools` come first: the document lists them per operating system, and on Windows it requires `DEPOT_TOOLS_WIN_TOOLCHAIN=0` so that `depot_tools` uses the locally installed Visual Studio.

Sources: [docs/development/build-instructions-gn.md:7-42](repo://docs/development/build-instructions-gn.md#L7-L42)

## Generate a build and compile

Two argument sets are provided: `testing.gn` (the one used for development and the test suite) and `release.gn`. Both import `all.gn`, which sets `is_electron_build = true`, adds `//electron` as an extra root dependency and pins Electron-specific values such as the Node module version and the V8 embedder string.

```sh
cd src
export CHROMIUM_BUILDTOOLS_PATH=`pwd`/buildtools
gn gen out/Testing --args="import(\"//electron/build/args/testing.gn\")"
ninja -C out/Testing electron
```

Sources: [docs/development/build-instructions-gn.md:99-128](repo://docs/development/build-instructions-gn.md#L99-L128), [docs/development/build-instructions-gn.md:163-170](repo://docs/development/build-instructions-gn.md#L163-L170), [build/args/all.gn:1-8](repo://build/args/all.gn#L1-L8)

The Testing configuration imports `all.gn` and then selects a non-component, non-official build with DCHECKs always on and `symbol_level = 1`:

```gn
import("//electron/build/args/all.gn")
is_debug = false
is_component_build = false
is_component_ffmpeg = true
is_official_build = false
dcheck_always_on = true
symbol_level = 1
```

Sources: [build/args/testing.gn:1-7](repo://build/args/testing.gn#L1-L7)

To change arguments later, run `gn args out/Testing` rather than `gn gen` again. A distributable zip comes from the `electron:electron_dist_zip` target, and cross-compiling sets `target_cpu` / `target_os` in the arguments.

Sources: [docs/development/build-instructions-gn.md:161-162](repo://docs/development/build-instructions-gn.md#L161-L162), [docs/development/build-instructions-gn.md:192-208](repo://docs/development/build-instructions-gn.md#L192-L208)

## Run it

The executable lands under `out/Testing`: `Electron.app/Contents/MacOS/Electron` on macOS, `electron.exe` on Windows, `electron` on Linux. Run with no app argument it starts the default app; [[Main Process Startup]] explains how `lib/browser/init.ts` falls back to it.

Sources: [docs/development/build-instructions-gn.md:182-190](repo://docs/development/build-instructions-gn.md#L182-L190)

`yarn start` (`script/start.js`) spawns that executable for you, forwards the remaining arguments, exits with its exit code, and relays `SIGINT`, `SIGTERM` and `SIGUSR2` to the child.

```js
const electronPath = utils.getAbsoluteElectronExec();

const child = cp.spawn(electronPath, process.argv.slice(2), { stdio: 'inherit' });
child.on('close', (code) => process.exit(code));
```

Sources: [script/start.js:5-19](repo://script/start.js#L5-L19), [package.json:90-91](repo://package.json#L90-L91)

`getAbsoluteElectronExec` picks the output directory in `script/lib/utils.js`. If `ELECTRON_OUT_DIR` is set it must exist under `out/`, otherwise the first existing of `Testing`, `Release`, `Default`, `Debug` is used; with none present it throws.

Sources: [script/lib/utils.js:15-62](repo://script/lib/utils.js#L15-L62)

> [!TIP]
> `yarn repl` is `script/start.js --interactive`: the default app's `--interactive` / `-i` flag opens a REPL in the main process.

Sources: [package.json:90](repo://package.json#L90), [default_app/main.ts:35-60](repo://default_app/main.ts#L35-L60)

## The default app

When Electron is started without an app, `default_app/main.ts` handles the command line. It accepts `--app=` , `--interactive`, `--require`, `--version` and `--abi`, and a path to a folder holding a `package.json` (or to a script). It copies version, name, desktop name and `v8Flags` from that `package.json` the same way `lib/browser/init.ts` does for packaged apps.

Sources: [default_app/main.ts:21-60](repo://default_app/main.ts#L21-L60), [default_app/main.ts:77-132](repo://default_app/main.ts#L77-L132), [default_app/main.ts:283-292](repo://default_app/main.ts#L283-L292)

## Check your change

`yarn test` runs `script/spec-runner.js`, and `yarn lint` runs the linters; both are defined in `package.json`. The test harness is covered in [[Testing]], and the generated typings the tests depend on in [[API Documentation Pipeline]]. If your change needs an edit to Chromium or Node, read [[Patch System]] first.

Sources: [package.json:64-72](repo://package.json#L64-L72), [package.json:87-92](repo://package.json#L87-L92)
