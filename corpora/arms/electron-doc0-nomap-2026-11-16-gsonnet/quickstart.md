---
title: "Building and Running Electron from Source"
---
## Overview

This page takes a contributor from a checkout to a running Electron binary and shows where each part of the repository lives. Electron is built with GN and ninja, with Chromium and Node.js fetched as dependencies by `gclient`; the repository itself checks out under `src/electron` of that tree. For what the binary does once it starts, see [[Electron Architecture Overview]].

Sources: [docs/development/build-instructions-gn.md:1-21](repo://docs/development/build-instructions-gn.md#L1-L21), [docs/development/build-instructions-gn.md:59-66](repo://docs/development/build-instructions-gn.md#L59-L66)

## Repository layout

The directories a contributor touches most are `shell/` (C++), `lib/` (TypeScript), `patches/`, `spec/`, `default_app/` and `build/`.

Sources: [docs/development/source-code-directory-structure.md:11-50](repo://docs/development/source-code-directory-structure.md#L11-L50)

```text
build/        GN configuration, webpack configs, fuse definitions
chromium_src/ code copied from Chromium that is not part of the content layer
default_app/  the app run when Electron starts without a consumer app
lib/          JavaScript/TypeScript that runs inside each process
patches/      patches applied on top of Chromium, Node.js and other dependencies
shell/        the C++ implementation
spec/         the test application
```

Sources: [docs/development/source-code-directory-structure.md:11-50](repo://docs/development/source-code-directory-structure.md#L11-L50)

The sub-folders of `lib/` map to process kinds: `browser`, `renderer`, `sandboxed_renderer`, `isolated_renderer`, `worker`, `utility`, `node` and `preload_realm`, plus `common` shared between them. Each target has an `init.ts` that is the entry of one bundle: see [[JavaScript Bundles and the GN Build Pipeline]].

Sources: [build/webpack/webpack.config.base.js:29-33](repo://build/webpack/webpack.config.base.js#L29-L33), [BUILD.gn:165-235](repo://BUILD.gn#L165-L235)

## Fetch the code

`gclient` reads the `DEPS` file inside `src/electron` to find Chromium, Node.js and the other dependencies, so syncing again after pulling keeps them matched to the checkout.

Sources: [docs/development/build-instructions-gn.md:86-89](repo://docs/development/build-instructions-gn.md#L86-L89)

```sh
mkdir electron && cd electron
gclient config --name "src/electron" --unmanaged https://github.com/electron/electron
gclient sync --with_branch_heads --with_tags
```

Sources: [docs/development/build-instructions-gn.md:61-66](repo://docs/development/build-instructions-gn.md#L61-L66)

After a `git pull` inside `src/electron`, run `gclient sync -f`.

Sources: [docs/development/build-instructions-gn.md:91-97](repo://docs/development/build-instructions-gn.md#L91-L97)

## Configure and build

`BUILD.gn` defines how Electron itself is built, and `build/args/{testing,release,all}.gn` hold the default build arguments. The testing configuration imports `all.gn` and turns on DCHECKs.

Sources: [docs/development/build-instructions-gn.md:25-30](repo://docs/development/build-instructions-gn.md#L25-L30), [build/args/testing.gn:1-6](repo://build/args/testing.gn#L1-L6)

```sh
cd src
export CHROMIUM_BUILDTOOLS_PATH=`pwd`/buildtools
gn gen out/Testing --args="import(\"//electron/build/args/testing.gn\")"
ninja -C out/Testing electron
```

Sources: [docs/development/build-instructions-gn.md:101-128](repo://docs/development/build-instructions-gn.md#L101-L128), [docs/development/build-instructions-gn.md:163-170](repo://docs/development/build-instructions-gn.md#L163-L170)

The result is `out/Testing/electron` on Linux, with `Electron.app` on macOS and `electron.exe` on Windows. The release configuration is generated the same way from `release.gn`, and `ninja -C out/Release electron:electron_dist_zip` packages a distributable zip.

Sources: [docs/development/build-instructions-gn.md:140-146](repo://docs/development/build-instructions-gn.md#L140-L146), [docs/development/build-instructions-gn.md:182-198](repo://docs/development/build-instructions-gn.md#L182-L198)

## Run the built binary

`npm start` runs `script/start.js`, which spawns the built Electron executable with your arguments, inherits stdio, and forwards `SIGINT`, `SIGTERM` and `SIGUSR2` to the child.

Sources: [package.json:91-91](repo://package.json#L91-L91), [script/start.js:1-19](repo://script/start.js#L1-L19)

Which build it picks is decided in `script/lib/utils.js`: `ELECTRON_OUT_DIR` if set, otherwise the first existing of `Testing`, `Release`, `Default` and `Debug` under `out/`.

Sources: [script/lib/utils.js:28-58](repo://script/lib/utils.js#L28-L58)

```sh
export ELECTRON_OUT_DIR=Testing
npm start -- path/to/app
```

Sources: [script/start.js:1-8](repo://script/start.js#L1-L8), [script/lib/utils.js:28-37](repo://script/lib/utils.js#L28-L37)

## Default app

When the binary is started without an app, `lib/browser/init.ts` falls through to `default_app.asar`, and the code in `default_app/main.ts` interprets the command line. A path ending in `.html`, a URL, or a package directory is loaded; `--version` and `--abi` print and exit; `--interactive` starts a REPL on the main process; with nothing at all it prints a usage message and loads the welcome page `index.html`.

Sources: [default_app/main.ts:20-62](repo://default_app/main.ts#L20-L62), [default_app/main.ts:254-298](repo://default_app/main.ts#L254-L298)

How the search order for `app.asar`, `app` and `default_app.asar` works is covered in [[Process Startup and Main Process Boot]].

Sources: [shell/common/node_bindings.cc:679-700](repo://shell/common/node_bindings.cc#L679-L700)

## Where to go next

Run the tests with `npm test`: see [[Test Suite and Spec Runner]].

Sources: [package.json:92-92](repo://package.json#L92-L92)

To change an upstream dependency, see [[Upstream Patches and Dependencies]].

Sources: [patches/config.json:1-16](repo://patches/config.json#L1-L16)
