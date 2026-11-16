---
type: workflow
title: Building Electron with GN and Ninja
description: End-to-end build workflow for Electron. Covers the gclient checkout layout, the GN argument files under build/args, the BUILD.gn targets (electron, electron_lib, the bundle and fuse actions, and the dist zip targets), the TypeScript and webpack steps that compile lib/ into per-process bundles, the helper scripts under script/, and the platform prerequisites.
tags: [build, gn, ninja, gclient, webpack, typescript, build-args, dist-zip]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T11:29:50.477Z
sources:
  - id: openwiki-source-ec2e5719a4f01093665ba043
    resource: repo://BUILD.gn
  - id: openwiki-source-f46d5bad520e315f61552c31
    resource: repo://build/args/all.gn
  - id: openwiki-source-8c67fa9ef643396b45de02ad
    resource: repo://build/args/release.gn
  - id: openwiki-source-c53eb66f6313d5072e2a9dad
    resource: repo://build/args/testing.gn
  - id: openwiki-source-229db3712029303a8efc1b80
    resource: repo://build/npm.gni
  - id: openwiki-source-b63cd99a26c5ff7b460c305e
    resource: repo://build/webpack/webpack.gni
  - id: openwiki-source-1e59d294433f0c981874804a
    resource: repo://script/lib/utils.js
  - id: openwiki-source-890aa2f7845d954a96cefaac
    resource: repo://script/start.js
generated: { by: "claude-code", at: "2026-11-16T11:29:50.477Z" }
---

# Building Electron with GN and Ninja

Electron is built with GN (project generation) and Ninja (compilation), using the Chromium toolchain. The Electron repository is placed inside a Chromium checkout as `src/electron`, and `DEPS` pins Chromium, Node.js, and the other dependencies. Electron's own build rules are in `BUILD.gn` and its `.gni` helpers. The JavaScript and TypeScript parts are built by npm and webpack actions that GN invokes.

## Checkout layout

The contributor documentation (`docs/development/build-instructions-gn.md`) describes a `gclient` checkout: a parent `src/` directory (Chromium) with the Electron repository at `src/electron`. Scripts rely on that layout. `script/lib/utils.js` defines `ELECTRON_DIR` as the repository root and `SRC_DIR` as its parent. The build also refers to `../third_party/electron_node` for Node.js, and `DEPS` places the Node.js checkout under `src/third_party/electron_node`.

Setup steps from the documentation:

1. Install `depot_tools`. On Windows, set `DEPOT_TOOLS_WIN_TOOLCHAIN=0` so the locally installed Visual Studio is used.
2. Optionally set `GIT_CACHE_PATH` to speed up repeated checkouts.
3. Run `gclient config --name "src/electron" --unmanaged <repo>` and `gclient sync --with_branch_heads --with_tags`.
4. After a `git pull` in `src/electron`, run `gclient sync -f` so dependencies match the updated `DEPS`.

`gclient sync` also runs the hooks in `DEPS`, including the patch application described in [Chromium, Node, and V8 Patch Stack](../integrations/chromium-node-v8-patches.md).

## Build arguments

`build/args/` holds the GN argument files:

- `all.gn` is the shared base. It sets `is_electron_build = true`, pulls in `//electron` as a root dependency, pins `node_module_version`, sets the V8 embedder string to `-electron.0`, enables proprietary codecs, and disables a set of Chromium development-only outputs so that the zip manifests match between testing and release builds.
- `testing.gn` imports `all.gn` and builds a debug-like configuration: `is_debug = false`, `dcheck_always_on = true`, `is_official_build = false`, `symbol_level = 1`. The `dcheck_always_on` setting is what enables the `--set-fuse-*` switches (see [Fuses and ASAR Integrity](../concepts/fuses-and-integrity.md)).
- `release.gn` imports `all.gn` and sets `is_official_build = true`, which makes the webpack bundles build in production mode.
- `native_tests.gn` adds the native test target for the `spec-chromium` directory.
- `ffmpeg.gn` is the additional argument file for the FFmpeg build.

Two build-argument sources are read by `BUILD.gn`'s helpers. `buildflags/buildflags.gni` declares Electron-specific arguments in `declare_args`, such as `enable_electron_extensions`, `enable_builtin_spellchecker`, `override_electron_version`, and `electron_vendor_version`. Packagers can set the version and vendor fields through GN arguments so that the build does not read the git tag.

Typical commands, from the documentation:

```sh
$ gn gen out/Testing --args='import("//electron/build/args/testing.gn")'
$ gn gen out/Release --args='import("//electron/build/args/release.gn")'
$ gn args out/Testing --list
```

`gn args` edits an existing directory's configuration without regenerating it.

## Targets in BUILD.gn

- `electron` is the top-level group. Its only dependency is `:electron_app`, which is the application bundle (or directory on Linux and Windows).
- `electron_lib` is a `source_set` that contains Electron's C++ sources in `shell/`. Its file lists come from `filenames.gni`, `filenames.auto.gni`, `filenames.libcxx.gni`, and the other generated lists at the repository root.
- `electron_fuses` is an `action` that runs `build/fuses/build.py` on `build/fuses/fuses.json5` and produces `fuses.h` and `fuses.cc`.
- `generate_mas_config` (in `build/config/BUILD.gn`) runs `script/generate-mas-config.py` for the Mac App Store macro.
- `electron_generate_node_defines` produces the Node-related macro headers from `third_party/electron_node` sources.
- The `*_bundle` targets (`electron_browser_bundle`, `electron_renderer_bundle`, `electron_worker_bundle`, `electron_sandboxed_renderer_bundle`, `electron_isolated_renderer_bundle`, `electron_node_bundle`, `electron_utility_bundle`, `electron_preload_realm_bundle`) run webpack through `webpack_build` (see below).
- `default_app_js` (around line 283) is a `typescript_build` for `default_app/`, using `tsconfig.default_app.json`.
- `electron_dist_zip`, `electron_ffmpeg_zip`, `electron_chromedriver_zip`, and `electron_mksnapshot_zip` are `dist_zip` targets (around lines 1423-1485). `dist_zip` is a template (around line 1364) that gathers runtime deps and zips them. These are the packaging entry points.

Consequence: a change that adds a C++ file must be added to a `filenames*.gni` list, or it will not be compiled. A change that adds a TypeScript module to `lib/` must be reachable from a bundle's entry, or it will not be included.

## GN actions that call npm and tsc

`build/npm.gni` defines `npm_action`. Each action runs a `pre-flight` check (`build/npm-run.py` calls `npm run pre-flight`) that is keyed on `package.json` and `yarn.lock`, then runs the requested npm script through `build/npm-run.py`. `build/tsc.gni` builds on this with `typescript_build`, which runs `tsc` with a given `tsconfig` and writes the output under the generated directory.

`build/webpack/webpack.gni` defines `webpack_build`. Each bundle target sets a `config_file` under `build/webpack/`, an `out_file` under `js2c/`, and an `inputs` list. The action runs webpack with the generated `buildflags.h` passed as an environment argument, and with `mode=production` for official builds and `mode=development` otherwise. The bundled outputs are then turned into C++ source by `build/js2c.py`, as described in [JavaScript API Layer](../architecture/js-api-layer.md).

`build/siso/` contains Starlark files (`main.star`, `backend.star`) for the Siso build backend.

## Compiling and running

Build the app with the `electron` target:

```sh
$ ninja -C out/Testing electron
$ ninja -C out/Release electron
```

The binary is written under the output directory: `Electron.app/Contents/MacOS/Electron` on macOS, `electron.exe` on Windows, and `electron` on Linux. `script/start.js` runs the built binary and forwards its arguments and termination signals (`SIGINT`, `SIGTERM`, `SIGUSR2`). It locates the binary with `getAbsoluteElectronExec` in `script/lib/utils.js`.

To produce distributable zips, build the dist target:

```sh
$ ninja -C out/Release electron:electron_dist_zip
```

Packaging, manifests, and symbols are covered in [Code Signing, Packaging, and Distribution Artifacts](../concepts/code-signing-and-packaging.md).

## Node-related scripts

`script/node/` holds helpers that generate files from the Node.js tree, including `generate_node_headers.py`, `generate_node_version_header.py`, and `generate_original_fs.py`, which reads from `../../third_party/electron_node`. `build/generate_node_defines.py` is the GN action script for the Node macro headers.

## Platform prerequisites

Platform-specific requirements are in `docs/development/build-instructions-macos.md`, `build-instructions-linux.md`, and `build-instructions-windows.md`. The repository's `.nvmrc` pins Node `20` for the npm scripts that run during the build.

## Failure behavior

- A GN action that calls npm fails the build if the npm script exits non-zero. `build/npm-run.py` prints the captured output and exits with the same code.
- A `gn gen` that is not rerun after a change to `build/args` keeps the old configuration. Use `gn args` to edit the arguments.
- A `typescript_build` or `webpack_build` input that is not listed in `inputs` will not trigger a rebuild when it changes.

## Related pages

- [Architecture Overview](../architecture/overview.md)
- [JavaScript API Layer](../architecture/js-api-layer.md)
- [Chromium, Node, and V8 Patch Stack](../integrations/chromium-node-v8-patches.md)
- [Testing](testing-spec-suite.md)
- [Linting and Formatting](linting.md)
