---
title: "Building and Testing Electron"
---
## Overview

Building this repository produces the Electron runtime used to run applications and the repository's specs. The native build uses GN to generate configuration and Ninja to compile it, while build rules generate API types, bundle runtime JavaScript, and package the default application. [[Quickstart]] uses the resulting executable; release asset verification and publication continue separately in [[Release Pipeline]].

Sources: [docs/development/build-instructions-gn.md:15-30](repo://docs/development/build-instructions-gn.md#L15-L30), [BUILD.gn:154-179](repo://BUILD.gn#L154-L179), [BUILD.gn:237-315](repo://BUILD.gn#L237-L315), [script/start.js:1-8](repo://script/start.js#L1-L8), [script/release/release.ts:414-432](repo://script/release/release.ts#L414-L432)

## Prepare the source layout

The build instructions require depot_tools and point to platform prerequisite guides. Linux prerequisites include Python, Node.js, clang, and GTK/libnotify development headers; macOS lists Xcode requirements; Windows requires the Visual Studio toolchain even though compilation is driven by command-line scripts. On Windows, the GN setup instructions set `DEPOT_TOOLS_WIN_TOOLCHAIN=0` to select the locally installed toolchain.

Sources: [docs/development/build-instructions-gn.md:7-42](repo://docs/development/build-instructions-gn.md#L7-L42), [docs/development/build-instructions-linux.md:7-13](repo://docs/development/build-instructions-linux.md#L7-L13), [docs/development/build-instructions-macos.md:7-22](repo://docs/development/build-instructions-macos.md#L7-L22), [docs/development/build-instructions-windows.md:7-17](repo://docs/development/build-instructions-windows.md#L7-L17), [docs/development/build-instructions-windows.md:38-44](repo://docs/development/build-instructions-windows.md#L38-L44)

For a fresh manual checkout, the repository's documented gclient sequence creates an outer directory and places Electron at `src/electron`. The surrounding `src` is the Chromium source root used by GN imports and runtime launcher paths. Run this setup in a new checkout location rather than nesting another source tree inside an existing Electron repository.

Sources: [docs/development/build-instructions-gn.md:59-69](repo://docs/development/build-instructions-gn.md#L59-L69), [BUILD.gn:1-26](repo://BUILD.gn#L1-L26), [script/lib/utils.js:8-9](repo://script/lib/utils.js#L8-L9)

```sh
mkdir electron && cd electron
gclient config --name "src/electron" --unmanaged https://github.com/electron/electron
gclient sync --with_branch_heads --with_tags
```

Sources: [docs/development/build-instructions-gn.md:61-65](repo://docs/development/build-instructions-gn.md#L61-L65)

`DEPS` pins Chromium, Node, and supporting repositories and controls checkout and patch application. The repository's update instructions run `gclient sync -f` after pulling Electron changes so dependencies match that file. The Yarn wrapper also reads its required Yarn version directly from DEPS and launches that version through npx, rather than relying on an arbitrary global installation.

Sources: [DEPS:3-49](repo://DEPS#L3-L49), [DEPS:77-88](repo://DEPS#L77-L88), [docs/development/build-instructions-gn.md:86-97](repo://docs/development/build-instructions-gn.md#L86-L97), [script/yarn.js:5-18](repo://script/yarn.js#L5-L18)

## Generate and build a configuration

On Linux or macOS, move into the outer `src` directory and set `CHROMIUM_BUILDTOOLS_PATH` to its `buildtools` directory as shown in the build instructions. Generate a Testing configuration by importing Electron's testing arguments. The preset turns debug mode off but enables DCHECKs and sets symbol level 1; the Release preset marks the build official. Configuration names belong under `out` and can be changed through `gn args`.

Sources: [docs/development/build-instructions-gn.md:99-128](repo://docs/development/build-instructions-gn.md#L99-L128), [docs/development/build-instructions-gn.md:158-161](repo://docs/development/build-instructions-gn.md#L158-L161), [build/args/testing.gn:1-7](repo://build/args/testing.gn#L1-L7), [build/args/release.gn:1-9](repo://build/args/release.gn#L1-L9)

```sh
gn gen out/Testing --args="import(\"//electron/build/args/testing.gn\")"
ninja -C out/Testing electron
```

Sources: [docs/development/build-instructions-gn.md:126-128](repo://docs/development/build-instructions-gn.md#L126-L128), [docs/development/build-instructions-gn.md:163-170](repo://docs/development/build-instructions-gn.md#L163-L170)

The executable is emitted below that output directory, with a platform-specific name: `Electron.app/Contents/MacOS/Electron`, `electron.exe`, or `electron`. For a distributable runtime archive, the documented Release target is `electron:electron_dist_zip`. This target packages the runtime build; the release scripts later validate the broader set of uploaded distribution artifacts.

Sources: [docs/development/build-instructions-gn.md:182-198](repo://docs/development/build-instructions-gn.md#L182-L198), [script/release/release.ts:419-428](repo://script/release/release.ts#L419-L428)

## Understand generated runtime code

GN defines separate webpack bundles for browser, renderer, worker, sandboxed renderer, isolated renderer, Node, utility, and preload-realm startup. `electron_js2c` depends on those bundles and invokes `build/js2c.py` to produce `electron_natives.cc`. Editing runtime TypeScript therefore feeds the generated native runtime through the build graph. The default application's TypeScript and static assets are built separately into `resources/default_app.asar`.

Sources: [BUILD.gn:165-272](repo://BUILD.gn#L165-L272), [BUILD.gn:281-315](repo://BUILD.gn#L281-L315)

The definitions build invokes the package's `gn-typescript-definitions` script. That script runs API JSON generation, TypeScript definition generation, and a TypeScript smoke runner before copying the generated definitions. API documentation is an explicit input to the GN definitions target, so documentation and generated public types participate in the same contributor workflow.

Sources: [BUILD.gn:154-163](repo://BUILD.gn#L154-L163), [package.json:79-81](repo://package.json#L79-L81), [script/create-api-json.mjs:1-18](repo://script/create-api-json.mjs#L1-L18)

## Select the local executable

From the Electron repository root, `npm start` invokes `script/start.js`, which resolves a local executable and forwards its arguments. `ELECTRON_OUT_DIR` chooses an explicit existing output directory. Otherwise the selector tries Testing, Release, Default, and Debug in order. It throws if no valid directory exists, or if an explicitly chosen directory is missing. The launcher forwards termination signals and exits with the child's close code.

Sources: [package.json:90-92](repo://package.json#L90-L92), [script/lib/utils.js:15-61](repo://script/lib/utils.js#L15-L61), [script/start.js:1-19](repo://script/start.js#L1-L19)

## Run targeted specs and checks

The repository's JavaScript specs are themselves an Electron application with a separate dependency manifest. `npm test` first runs the package pretest command to generate definitions, then starts `script/spec-runner.js`. To select tests by name, the existing testing guide gives an IPC example:

Sources: [docs/development/testing.md:22-38](repo://docs/development/testing.md#L22-L38), [package.json:79-92](repo://package.json#L79-L92)

```sh
npm run test -- -g ipc
```

Sources: [docs/development/testing.md:35-38](repo://docs/development/testing.md#L35-L38)

The runner compares hashes of spec dependency inputs and the installed modules, reinstalling when they differ. Local native spec dependencies use headers under the selected output directory; an explicit Electron version uses that version's installed headers instead. It then launches the spec application with forwarded flags. On Linux the launch is wrapped by `dbus_mock.py`. Runner errors and failing child processes produce nonzero exits.

Sources: [script/spec-runner.js:92-107](repo://script/spec-runner.js#L92-L107), [script/spec-runner.js:194-218](repo://script/spec-runner.js#L194-L218), [script/spec-runner.js:224-285](repo://script/spec-runner.js#L224-L285)

| Changed area | Repository check |
| --- | --- |
| JavaScript or TypeScript implementation | `npm run lint:js` and relevant spec selection |
| Native C++ implementation | `npm run lint:cpp` and clang-format check |
| GN configuration | `npm run gn-check` and `npm run gn-format` |
| Existing API documentation | `npm run lint:docs`, including generated types, examples, links, and API history |
| Node embedding behavior | Node smoke runner with an optional Node test path |

Sources: [package.json:64-84](repo://package.json#L64-L84), [docs/development/testing.md:30-59](repo://docs/development/testing.md#L30-L59)
