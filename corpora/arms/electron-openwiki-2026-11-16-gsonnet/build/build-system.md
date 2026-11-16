---
type: build
title: Build System (GN, DEPS, Webpack, Generated Files)
description: How Electron is built as a component inside a Chromium checkout using gclient DEPS, GN/ninja with BUILD.gn and filenames.gni source lists, build args and buildflags, generated headers (fuses, version), the webpack-to-js2c JavaScript pipeline, and packaging into app bundles, asar and zip artifacts.
tags: [gn, ninja, gclient, deps, buildflags, build, packaging]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T09:55:01.404Z
sources:
  - id: openwiki-source-ec2e5719a4f01093665ba043
    resource: repo://BUILD.gn
  - id: openwiki-source-f46d5bad520e315f61552c31
    resource: repo://build/args/all.gn
  - id: openwiki-source-179c3227b4b25a4f980f1b84
    resource: repo://build/asar.gni
  - id: openwiki-source-8a35ee6a27dea5f50a49b698
    resource: repo://build/fuses/build.py
  - id: openwiki-source-948a7a9d83defa7e291d47d4
    resource: repo://build/fuses/fuses.json5
  - id: openwiki-source-fb17036690b0875a131877b5
    resource: repo://buildflags/BUILD.gn
  - id: openwiki-source-849c13b8a23bffaf7502b94b
    resource: repo://buildflags/buildflags.gni
  - id: openwiki-source-29cf14000ac0366c40fd5358
    resource: repo://DEPS
  - id: openwiki-source-e6a032917c6dd65e2c267f13
    resource: repo://docs/development/creating-api.md
  - id: openwiki-source-06306918f0e6a90a63126d92
    resource: repo://filenames.gni
  - id: openwiki-source-0e4201c67cf80162df957f59
    resource: repo://script/gen-filenames.ts
generated: { by: "claude-code", at: "2026-11-16T09:55:01.404Z" }
---

# Build System (GN, DEPS, Webpack, Generated Files)

This repository is **not built standalone**. It is checked out as `src/electron` inside a Chromium source tree by `gclient`, and Electron's `BUILD.gn` is pulled into Chromium's GN graph. The product is a Chromium binary with Electron's shell, a statically linked Node.js, and bundled JavaScript.

## Checkout: DEPS and gclient

`DEPS` is a gclient file with pinned versions as variables (`chromium_version`, `node_version`, `nan_version`, `squirrel.mac_version`, ...). Its `deps` map checks out `src` (Chromium), `src/third_party/electron_node` (Node.js), `nan`, Squirrel.Mac with its Mantle and ReactiveObjC vendors, and EngFlow reclient configs; each is gated by `checkout_*` conditions so in-house builds can supply them manually. `gclient_gn_args_from = 'src'` means GN args come from Chromium's DEPS.

<!-- openwiki: broken internal link [/openwiki/build/upstream-patches.md] link "/openwiki/build/upstream-patches.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
Hooks run after sync, in order: `pre_deps_hooks` generate an mtime cache of patched files; `patch_chromium` runs `script/apply_all_patches.py` over `patches/config.json` to apply every patch set to its upstream repo ([upstream patches](/openwiki/build/upstream-patches.md)); `apply_mtime_cache` restores file modification times so ninja doesn't rebuild untouched patched files; `electron_npm_deps` runs `yarn install --frozen-lockfile` in `src/electron` with a pinned Yarn version; and per-arch Linux sysroot installers run for supported CPUs. Updating Chromium or Node therefore means bumping the version vars and re-exporting patches.

## GN configuration

- **Build args.** `build/args/all.gn` holds the shared defaults: `is_electron_build = true`, `root_extra_deps = [ "//electron" ]` (this is how Electron gets into the root Chromium build), the Node ABI `node_module_version`, V8 embedder flags such as `v8_promise_internal_field_count = 1` and `v8_enable_javascript_promise_hooks = true`, proprietary codecs, printing, and several disabled Chromium features (CET shadow stack, CFI) that conflict with running V8 in the browser process. `release.gn` and `testing.gn` import it: release is an official, non-component build with `is_component_ffmpeg = true`; testing is non-official with `dcheck_always_on = true` and `symbol_level = 1`. `ffmpeg.gn` and `native_tests.gn` serve other targets.
<!-- openwiki: broken internal link [/openwiki/architecture/js-bundles-and-internal-modules.md] link "/openwiki/architecture/js-bundles-and-internal-modules.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- **Build flags.** `buildflags/buildflags.gni` declares feature args (`enable_pdf_viewer`, `enable_electron_extensions`, `enable_builtin_spellchecker`, `enable_fake_location_provider` which defaults to `!is_official_build`, `override_electron_version`, `electron_vendor_version`). `buildflags/BUILD.gn` turns them into a `buildflags.h` via `buildflag_header`, used in C++ as `BUILDFLAG(ENABLE_...)` and parsed by webpack to substitute the same flags in JS ([JS bundles](/openwiki/architecture/js-bundles-and-internal-modules.md)).
- **Source lists.** `filenames.gni` enumerates sources: `lib_sources` plus platform variants (`lib_sources_mac`, `_win`, `_linux`, `_posix`, `_views`, `_extensions`), framework/login-helper sources, default-app sources, and so on. New `.cc/.h` files **must be added here** or they will not compile (the "creating an API" guide calls this out). `script/gn-check.js` runs `gn check` and the lint-staged hooks run `gn format`/`gn-check` on `.gn`/`.gni` edits. `filenames.hunspell.gni`, `filenames.libcxx.gni` and `filenames.libcxxabi.gni` are generated from other sources by `script/gen-hunspell-filenames.js` and `script/gen-libc++-filenames.js`.
- **Generated list `filenames.auto.gni`.** Produced by `script/gen-filenames.ts`: it enumerates `docs/api/**` and, for each webpack bundle, runs webpack in a graph-printing mode and records the `lib/` files each bundle depends on, so GN rebuilds a bundle when any of its inputs change. It must be regenerated after changing docs or JS imports (lint-staged does so on commit).

## Key targets in `BUILD.gn`

- `electron_lib` is the big `source_set` of `shell/` code (with OS conditionals, `is_linux`/`is_win`/`is_mac`, extension and PDF viewer pieces, and a Windows-only ASAR-integrity implementation). It depends on generated pieces such as `:electron_fuses`, `:electron_js2c`, version headers and Node (`//third_party/electron_node:libnode`).
<!-- openwiki: broken internal link [/openwiki/security/fuses-and-security-model.md] link "/openwiki/security/fuses-and-security-model.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- `electron_fuses` runs `build/fuses/build.py` over `build/fuses/fuses.json5` to emit `fuses.h`/`fuses.cc` containing the `kFuseWire` byte array and accessors such as `IsRunAsNodeEnabled()` ([fuses](/openwiki/security/fuses-and-security-model.md)).
- `electron_version_args` and `electron_version_header` generate version info from the git tag (via `script/generate-version-json.js`) unless `override_electron_version` is set; `electron_generate_node_defines` produces push/pop headers that isolate Node's macros from Chromium's.
<!-- openwiki: broken internal link [/openwiki/architecture/js-bundles-and-internal-modules.md] link "/openwiki/architecture/js-bundles-and-internal-modules.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- JS pipeline targets: `build_electron_definitions` (typings from docs), eight `webpack_build` targets and `electron_js2c` ([details](/openwiki/architecture/js-bundles-and-internal-modules.md)).
<!-- openwiki: broken internal link [/openwiki/architecture/utility-processes-and-asar.md] link "/openwiki/architecture/utility-processes-and-asar.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- `default_app_asar` builds `resources/default_app.asar` from the TypeScript in `default_app/` using the `asar` template in `build/asar.gni` (`script/gn-asar.js`), with a companion `_header_hash` target. On macOS the header hash is injected into `Info.plist` by `asar_hashed_info_plist` for integrity validation ([ASAR](/openwiki/architecture/utility-processes-and-asar.md)).
- `electron_app` is the main executable target (and on macOS the `electron_framework` bundle with `Electron Helper` variants and a login helper; templates live in `build/rules.gni`). Data deps include the `.pak` resource bundles (`packed_resources` from `build/electron_paks.gni`), locales, and a V8 context snapshot.
- Distribution groups: `dist_zip` (a template that writes runtime deps and zips them with `build/zip.py`), `electron_dist_zip`, `electron_chromedriver`, `electron_mksnapshot` (+ zip), `licenses`, `hunspell_dictionaries`, libc++ header and object zips, and `node_headers` (tarball of Node headers for native-module builds). On official Linux/Windows builds `extract_symbols` and `strip_binary` produce breakpad symbols and debug files.
- `group("electron")` simply depends on `:electron_app`.

## Local workflow

<!-- openwiki: broken internal link [/openwiki/testing/spec-suite.md] link "/openwiki/testing/spec-suite.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [/openwiki/workflows/docs-api-and-release.md] link "/openwiki/workflows/docs-api-and-release.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
`docs/development/build-instructions-gn.md` documents getting code with depot_tools and `gclient sync`, then `gn gen out/Testing --args='import("//electron/build/args/testing.gn")'` and `ninja -C out/Testing electron`; `electron-build-tools` (`e`) automates this. Running a built binary or the spec suite is covered in [testing](/openwiki/testing/spec-suite.md). Release builds add `release.gn`, symbol extraction and zip distribution, orchestrated by CI scripts under `script/release/` ([release tooling](/openwiki/workflows/docs-api-and-release.md)).

## Practical consequences

- Adding C++ files needs a `filenames.gni` edit; adding or renaming a docs API file or an imported TS module needs `script/gen-filenames.ts` to be re-run.
- Features that depend on build flags exist in both C++ and JS; changing `buildflags.gni` affects webpack output.
- Fuse defaults live in `build/fuses/fuses.json5`; the fuse wire is a sentinel-delimited byte array that downstream tools (e.g. `@electron/fuses`) can flip in the shipped binary.
