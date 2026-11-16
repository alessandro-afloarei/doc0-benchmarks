---
title: "Building and Testing"
---
## Overview

Building this repository produces the Electron framework executable. GN generates the build graph, Ninja builds its targets, and repository scripts run the resulting binary and API specifications. The application workflow in [[Quickstart]] uses that binary or a prebuilt installation; it does not replace the Chromium and Node dependency checkout needed for framework development. Release artifact validation and publication continue in [[Release Pipeline]].

Sources: [docs/development/build-instructions-gn.md:1-30](repo://docs/development/build-instructions-gn.md#L1-L30), [docs/development/build-instructions-gn.md:59-89](repo://docs/development/build-instructions-gn.md#L59-L89), [script/start.js:1-8](repo://script/start.js#L1-L8), [script/spec-runner.js:194-222](repo://script/spec-runner.js#L194-L222), [script/release/release.ts:414-432](repo://script/release/release.ts#L414-L432)

## Prepare the checkout

The platform build documents in this checkout list Node.js 22.12.0 or newer; Linux and macOS also list Python 3.9 or newer. Linux needs development headers including GTK 3 and libnotify, macOS needs an Xcode version appropriate to the branch, and Windows needs Visual Studio's native toolchains even though builds run from command-line scripts. These requirements belong to the checked-out branch, so use its platform instructions when preparing the machine.

Sources: [docs/development/build-instructions-linux.md:7-22](repo://docs/development/build-instructions-linux.md#L7-L22), [docs/development/build-instructions-macos.md:7-20](repo://docs/development/build-instructions-macos.md#L7-L20), [docs/development/build-instructions-windows.md:7-21](repo://docs/development/build-instructions-windows.md#L7-L21), [docs/development/build-instructions-windows.md:38-44](repo://docs/development/build-instructions-windows.md#L38-L44)

The manual workflow requires depot_tools and a gclient workspace with Electron at `src/electron`. From a new checkout parent directory, configure that layout and synchronize dependencies. On Windows, the documented `DEPOT_TOOLS_WIN_TOOLCHAIN=0` setting makes depot_tools use the locally installed Visual Studio toolchain. The repository also identifies Electron Build Tools as an alternative that automates setup and configurations.

Sources: [docs/development/build-instructions-gn.md:15-42](repo://docs/development/build-instructions-gn.md#L15-L42), [docs/development/build-instructions-gn.md:59-69](repo://docs/development/build-instructions-gn.md#L59-L69)

```sh
gclient config --name "src/electron" --unmanaged https://github.com/electron/electron
gclient sync --with_branch_heads --with_tags
```

Sources: [docs/development/build-instructions-gn.md:61-66](repo://docs/development/build-instructions-gn.md#L61-L66)

`DEPS` records dependency versions and synchronization hooks. Its hooks apply Electron patches when enabled and install the repository's JavaScript dependencies using the configured Yarn version with a frozen lockfile. After pulling changes to the Electron checkout, the build guide uses `gclient sync -f` to align dependencies with that file. A source-only clone without these dependencies is therefore incomplete for the documented native build.

Sources: [DEPS:1-18](repo://DEPS#L1-L18), [DEPS:129-160](repo://DEPS#L129-L160), [docs/development/build-instructions-gn.md:86-97](repo://docs/development/build-instructions-gn.md#L86-L97)

## Generate and build a configuration

Run GN and Ninja from the workspace's `src` directory, one level above the Electron repository. On Linux and macOS, set `CHROMIUM_BUILDTOOLS_PATH` to that directory's `buildtools` path; Windows uses the equivalent environment assignment. A Testing configuration imports Electron's testing arguments, then the `electron` target builds the application dependency. The generated output directory lives under `src/out`, rather than inside `src/electron`.

Sources: [docs/development/build-instructions-gn.md:99-137](repo://docs/development/build-instructions-gn.md#L99-L137), [docs/development/build-instructions-gn.md:158-170](repo://docs/development/build-instructions-gn.md#L158-L170), [BUILD.gn:1557-1559](repo://BUILD.gn#L1557-L1559)

```sh
gn gen out/Testing --args="import(\"//electron/build/args/testing.gn\")"
ninja -C out/Testing electron
```

Sources: [docs/development/build-instructions-gn.md:124-128](repo://docs/development/build-instructions-gn.md#L124-L128), [docs/development/build-instructions-gn.md:163-170](repo://docs/development/build-instructions-gn.md#L163-L170)

Testing is not a debug build in this checkout: its arguments set `is_debug = false`, `is_official_build = false`, `dcheck_always_on = true` and symbol level 1. Release sets `is_official_build = true`. Both use noncomponent builds and a shared FFmpeg library; the release comment explains that shared FFmpeg supports users who do not want to ship proprietary codecs or need dynamic linking. For a release configuration, substitute the release argument import and `out/Release` directory documented by the build guide.

Sources: [build/args/testing.gn:1-7](repo://build/args/testing.gn#L1-L7), [build/args/release.gn:1-9](repo://build/args/release.gn#L1-L9), [docs/development/build-instructions-gn.md:140-176](repo://docs/development/build-instructions-gn.md#L140-L176)

The build graph generates Electron declarations for both editor use and the TypeScript build, then makes browser and renderer bundles depend on those definitions. A distributable archive is a separate target, `electron:electron_dist_zip`, producing `dist.zip` with application, version and license dependencies. Building an executable and packaging that output are distinct targets even when they share most compiled inputs.

Sources: [BUILD.gn:152-180](repo://BUILD.gn#L152-L180), [BUILD.gn:1423-1446](repo://BUILD.gn#L1423-L1446), [docs/development/build-instructions-gn.md:192-198](repo://docs/development/build-instructions-gn.md#L192-L198)

## Select and launch the binary

From the Electron repository, `npm start` calls the start wrapper, which locates the built executable, forwards arguments and inherits standard streams. Binary lookup prefers an explicit output directory or `ELECTRON_OUT_DIR`, otherwise it checks Testing, Release, Default and Debug in order. It validates directory existence and selects the platform-specific executable path. The wrapper propagates the child's close code and forwards SIGINT, SIGTERM and SIGUSR2 while the child remains alive.

Sources: [package.json:90-92](repo://package.json#L90-L92), [script/lib/utils.js:15-61](repo://script/lib/utils.js#L15-L61), [script/start.js:1-19](repo://script/start.js#L1-L19)

## Run focused specifications

The npm test script runs the spec runner, and its pretest hook generates TypeScript definitions first. The specifications are an Electron application with their own dependencies. Use `npm run test -- -g ipc` to select IPC tests, or omit the filter to run the suite. The runner forwards unrecognized flags to that application and currently registers the main-process runner. On Linux it launches through the repository's D-Bus mock wrapper.

Sources: [package.json:79-92](repo://package.json#L79-L92), [docs/development/testing.md:24-38](repo://docs/development/testing.md#L24-L38), [script/spec-runner.js:22-44](repo://script/spec-runner.js#L22-L44), [script/spec-runner.js:194-222](repo://script/spec-runner.js#L194-L222)

Before execution, the runner compares hashes for the specification package, lockfile, runner source and installed dependencies. Changes trigger reinstallation of the spec modules; the installer removes an existing spec node_modules directory and performs a frozen-lockfile Yarn install. Local native modules use headers from the selected output's `gen/node_headers`. With `--electronVersion`, the runner instead installs the requested release and configures native-module headers for that version.

Sources: [script/spec-runner.js:92-108](repo://script/spec-runner.js#L92-L108), [script/spec-runner.js:194-201](repo://script/spec-runner.js#L194-L201), [script/spec-runner.js:224-286](repo://script/spec-runner.js#L224-L286)

Nonzero test exit status or termination by signal makes the runner exit with failure. For changes to Node embedding, the separate Node spec runner runs the checked-out Node test harness with Electron as its shell and `ELECTRON_RUN_AS_NODE` enabled. It accepts forwarded Node test arguments, so it can target an individual test rather than requiring the entire Node suite for every change.

Sources: [script/spec-runner.js:207-217](repo://script/spec-runner.js#L207-L217), [script/node-spec-runner.js:15-18](repo://script/node-spec-runner.js#L15-L18), [script/node-spec-runner.js:41-57](repo://script/node-spec-runner.js#L41-L57), [script/node-spec-runner.js:80-90](repo://script/node-spec-runner.js#L80-L90), [docs/development/testing.md:40-59](repo://docs/development/testing.md#L40-L59)

## Validate interfaces and documentation

`npm run lint` combines the source linter with documentation checks. Targeted scripts cover JavaScript, C++, Objective-C, Python and GN. Documentation checking runs remark, JavaScript and TypeScript checks for Markdown examples, fiddle validation, relative-link checks, Markdown linting and API history checks. Because the remark invocation includes a fix flag, this command can modify documentation while validating it.

Sources: [package.json:64-78](repo://package.json#L64-L78)

API documentation also drives generated interfaces: the parser writes `electron-api.json`, TypeScript generation consumes it, and the definition script runs the TypeScript smoke runner. The GN definition action cites API docs as build inputs. An API change therefore needs consistent implementation, documentation and generated type behavior; these checks verify different parts of that connection before the artifact workflow in [[Release Pipeline]].

Sources: [script/create-api-json.mjs:8-18](repo://script/create-api-json.mjs#L8-L18), [package.json:79-81](repo://package.json#L79-L81), [BUILD.gn:152-163](repo://BUILD.gn#L152-L163)
