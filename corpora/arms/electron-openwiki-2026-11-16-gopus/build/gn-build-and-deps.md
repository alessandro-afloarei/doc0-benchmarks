---
type: workflow
title: GN build, DEPS and build configuration
description: How Electron is fetched with gclient and built with GN/ninja inside a Chromium checkout — DEPS pins and hooks, build/args presets, the main BUILD.gn targets (electron_lib, JS bundles, js2c, fuses, default_app.asar, electron_app, dist zips, node headers), filename lists, npm-driven build actions and pre-commit maintenance.
tags: [build, gn, ninja, gclient, deps, tooling]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T08:25:33.723Z
sources:
  - id: openwiki-source-43c41f18d49c25a86be5e9ae
    resource: repo://.husky/pre-commit
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
  - id: openwiki-source-29cf14000ac0366c40fd5358
    resource: repo://DEPS
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
generated: { by: "claude-code", at: "2026-11-16T08:25:33.723Z" }
---

# GN build, DEPS and build configuration

Electron is built as part of Chromium's GN/ninja build. This repository is
mounted at `src/electron`, `//electron` is added to Chromium's root
dependencies, and Electron's own `BUILD.gn` declares the targets that turn
Chromium + Node + Electron sources into the `electron` executable and its
distribution zips.

## Fetching sources: DEPS and gclient

The manual setup (most contributors use
[`@electron/build-tools`](https://github.com/electron/build-tools)'s `e`
command instead) is:

```sh
gclient config --name "src/electron" --unmanaged https://github.com/electron/electron
gclient sync --with_branch_heads --with_tags
```

`DEPS` (`gclient_gn_args_from = 'src'`) defines:

- **Version pins** in `vars`: `chromium_version`, `node_version`, plus nan,
  Squirrel.Mac, ReactiveObjC, Mantle, reclient configs and others.
- **Checkouts**: `src` (Chromium), `src/third_party/electron_node` (Node.js),
  `src/third_party/nan`, `src/third_party/squirrel.mac` with vendored
  frameworks, etc.
- **Hooks**: `patch_chromium` runs `script/apply_all_patches.py` to apply
  `patches/` (see
  [Patching Chromium, Node and other dependencies](chromium-and-node-patches.md)),
  an optional mtime cache keeps incremental builds fast, and further hooks
  install npm dependencies with the pinned Yarn.

Bumping Chromium or Node means editing `DEPS`, re-syncing and resolving patch
conflicts.

## Configuring: build/args

`gn gen out/Testing --args='import("//electron/build/args/testing.gn")'`
(or `release.gn`). Presets:

| File | Purpose |
| --- | --- |
| `build/args/all.gn` | always imported: `is_electron_build = true`, `root_extra_deps = ["//electron"]`, `node_module_version`, V8 embedder string and promise hooks, proprietary codecs, printing, disabled CFI/CET shadow stack (incompatible with V8 in the browser process), exposed V8 symbols for native modules |
| `build/args/testing.gn` | non-debug, non-component, `dcheck_always_on = true`, `symbol_level = 1` |
| `build/args/release.gn` | `is_official_build = true` (minified bundles, stripped binaries), component FFmpeg |
| `build/args/native_tests.gn`, `ffmpeg.gn` | native unit tests and the shared FFmpeg build |

Electron-specific feature toggles come from `buildflags/buildflags.gni`;
see [Fuses and build flags](../systems/fuses-and-build-flags.md).

## Building

```sh
ninja -C out/Testing electron                     # the app
ninja -C out/Release electron:electron_dist_zip   # dist.zip
```

`group("electron")` is just `:electron_app`. Notable targets in `BUILD.gn`:

| Target | What it does |
| --- | --- |
| `electron_lib` (source_set) | compiles `filenames.gni` `lib_sources*` lists plus platform/feature variants; depends on `electron_js2c`, `electron_fuses`, `electron_version_header`, generated node defines, resources and `buildflags` |
| `electron_*_bundle` + `electron_js2c` | webpack bundles of `lib/` embedded via Node's js2c — see [JS bundles, module lists and native bindings](../architecture/js-bundles-and-native-bindings.md) |
| `build_electron_definitions` | runs `npm run gn-typescript-definitions` to generate `electron.d.ts` from `docs/api` (input list: `auto_filenames.api_docs`) |
| `default_app_js` → `default_app_asar` | `typescript_build` of `default_app/` with `tsconfig.default_app.json`, copied statics and octicons, packed into `resources/default_app.asar` |
| `electron_fuses` | generates `fuses.h/.cc` from `build/fuses/fuses.json5` |
| `electron_generate_node_defines` | header shims so Node and Chromium macros (tracing, `util.h`) don't collide |
| `resources`, `packed_resources` | grit resources and `.pak` files |
| `electron_app` | the executable (`electron_main_{win,linux}.cc`) or, on macOS, `mac_app_bundle` with `electron_framework`, helper apps (`electron_helper_app` template) and login helper |
| `electron_dist_zip`, `electron_chromedriver_zip`, `electron_mksnapshot_zip`, `electron_ffmpeg_zip`, `hunspell_dictionaries_zip`, `libcxx*_zip` | release artifacts; official Linux builds strip binaries first |
| `node_headers` targets | `node_version_header`, `generate_node_headers`, `tar_node_headers` produce the headers native-module builders download |

### npm-driven actions

`build/npm.gni` defines `npm_action`, which first runs a `pre-flight` stamp
action (checking `package.json`/`yarn.lock` dependencies are installed) and
then invokes a `package.json` script through `build/npm-run.py`. The webpack
template (`build/webpack/webpack.gni`) and `typescript_build`
(`build/tsc.gni`) are built on it, so `node_modules` must be installed in
`src/electron` before building.

## Keeping file lists in sync

GN requires every source to be listed:

- **C++/ObjC** — add new files manually to the appropriate list in
  `filenames.gni` (`lib_sources`, `lib_sources_mac`, `lib_sources_win`,
  `lib_sources_linux`, `lib_sources_views`, `lib_sources_extensions`, …).
- **TypeScript and API docs** — `filenames.auto.gni` (marked
  "AUTO-GENERATED") is regenerated by `script/gen-filenames.ts`.

The `lint-staged` configuration in `package.json` (run by the husky
`precommit` hook) regenerates `filenames.auto.gni` when `.js/.ts/.d.ts` or
`docs/api/**/*.md` files change, runs `gn-check`/`gn-format` for `.gn/.gni`
changes, clang-format for C++, and `check-patch-diff.ts` for patches.

## Linting and other tooling

`npm run lint` drives `script/lint.js` (JS/TS via ESLint, C++ via
clang-format and cpplint-style checks, Python, GN, patches) and the docs
linters (`remark`, `markdownlint`, link and API-history checks). Clang-tidy is
available via `npm run lint:clang-tidy`. Remote execution / caching
(reclient, siso) is configured under `build/siso` and the reclient patch set.

## Related

- [Repository layout and layering](../architecture/repository-layout.md)
- [Testing: spec runner and test suites](../testing/spec-runner.md)
- [Releases and npm distribution](../operations/release-and-npm-distribution.md)
