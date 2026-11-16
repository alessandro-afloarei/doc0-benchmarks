---
type: workflow
title: Building Electron
description: How Electron is built from source, from gclient checkout of Chromium and Node.js through GN argument sets and the Ninja build, to the generated typings, webpack bundles, fuses, and distribution zips, with the GN arguments that change behavior.
tags: [electron, build, gn, ninja, gclient, deps, webpack, buildflags, args, packaging]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T18:50:06.090Z
sources:
  - id: openwiki-source-6f6acd7aaa4692944c47e9f8
    resource: repo://.github/actions/checkout/action.yml
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
  - id: openwiki-source-5521173dd114c87305d5bc7d
    resource: repo://build/webpack/webpack.config.base.js
  - id: openwiki-source-fb17036690b0875a131877b5
    resource: repo://buildflags/BUILD.gn
  - id: openwiki-source-849c13b8a23bffaf7502b94b
    resource: repo://buildflags/buildflags.gni
  - id: openwiki-source-29cf14000ac0366c40fd5358
    resource: repo://DEPS
  - id: openwiki-source-b55c1369c4912b5d57b1a8f8
    resource: repo://docs/development/build-instructions-gn.md
generated: { by: "claude-code", at: "2026-11-16T18:50:06.090Z" }
---

# Building Electron

<!-- openwiki: broken internal link [/openwiki/operations/ci-and-release.md] link "/openwiki/operations/ci-and-release.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
Building Electron means building Chromium, Node.js, and V8 with Electron's patches and layering Electron's own C++ and TypeScript on top. The source tree in this repository is the Electron layer, so the build starts with `gclient`, which fetches the upstream trees and applies the patches, and then runs GN and Ninja on the `electron` target. This page walks through that sequence in order and names the arguments that change the result. The shape of the resulting pipelines is covered in [CI, Release, and Distribution](/openwiki/operations/ci-and-release.md).

## Pinned versions

<!-- openwiki: broken internal link [/openwiki/architecture/chromium-and-upstream-patches.md] link "/openwiki/architecture/chromium-and-upstream-patches.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
`DEPS` pins the upstream versions. The current values are Chromium `141.0.7361.0` and Node.js `v22.18.0`. `DEPS` also sets the `apply_patches` variable, which is on by default and controls whether the patch hooks run during sync. The patches are described in [Chromium, Node, and Upstream Patches](/openwiki/architecture/chromium-and-upstream-patches.md).

## Step 1: check out the source with gclient

`docs/development/build-instructions-gn.md` gives the setup. Install `depot_tools` and the platform prerequisites first. The platform pages are `build-instructions-linux.md`, `build-instructions-macos.md`, and `build-instructions-windows.md`. On Windows, `DEPOT_TOOLS_WIN_TOOLCHAIN=0` makes `depot_tools` use a locally installed Visual Studio.

Optional environment variables:

- `GIT_CACHE_PATH` points at a shared git cache, which speeds up repeated checkouts.
- `CHROMIUM_BUILDTOOLS_PATH` points at Chromium's `buildtools` directory, and it must be set before running GN or Ninja.

The checkout is:

```sh
gclient config --name "src/electron" --unmanaged https://github.com/electron/electron
gclient sync --with_branch_heads --with_tags
```

`--unmanaged` tells `gclient` that `src/electron` is the repository under development, so `gclient` does not overwrite it. After a `git pull` inside `src/electron`, `gclient sync -f` brings the dependencies in line with the updated `DEPS` file.

During sync the `DEPS` hooks run `script/apply_all_patches.py` against `patches/config.json`. These hooks produce the patched Chromium, Node.js, and V8 trees. The CI checkout action can add three-way merging through `ELECTRON_USE_THREE_WAY_MERGE_FOR_PATCHES`. See the patches page for the details.

## Step 2: generate a build directory with GN

The build configuration is a set of GN argument files under `build/args/`. `build/args/all.gn` holds the shared settings, and the two named profiles import it:

<!-- openwiki: broken internal link [/openwiki/architecture/security-model-and-fuses.md] link "/openwiki/architecture/security-model-and-fuses.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- `build/args/testing.gn` sets `is_debug = false`, `is_official_build = false`, `dcheck_always_on = true`, `symbol_level = 1`, and `is_component_ffmpeg = true`. This is the profile for developing and running tests, because DCHECKs are on and the `--set-fuse-*` override described in [Security Model and Fuses](/openwiki/architecture/security-model-and-fuses.md) is available.
- `build/args/release.gn` sets `is_official_build = true` and `is_component_ffmpeg = true`. It is the profile for distributable binaries.

Generate a directory for each profile from `src/`:

```sh
gn gen out/Testing --args='import("//electron/build/args/testing.gn")'
gn gen out/Release --args='import("//electron/build/args/release.gn")'
```

`gn args out/Testing` opens the argument editor for an existing directory, and `gn args out/Testing --list` lists every option.

`build/args/all.gn` contains settings that apply to every profile, and these shape the output in ways that matter:

- `is_electron_build = true` and `root_extra_deps = [ "//electron" ]` make Chromium's GN graph include Electron's targets.
- `node_module_version = 140` is the Node ABI version, and `v8_embedder_string = "-electron.0"` marks V8 as an Electron build.
- `proprietary_codecs = true`, `ffmpeg_branding = "Chrome"`, and `enable_printing = true` set media and printing support.
- `enable_cet_shadow_stack = false` and `is_cfi = false` turn off two hardening features that conflict with V8. Their comments explain the reasons.
- `enable_pseudolocales = false` exists because pseudolocales would make the zip manifest differ between testing and release builds, and the manifests are checked in CI.

## Step 3: GN arguments that Electron reads directly

`buildflags/buildflags.gni` declares the Electron-specific arguments, and `buildflags/BUILD.gn` turns them into a `buildflags.h` header through `buildflag_header`. The arguments and their effects are:

- `enable_pdf_viewer` (default `true`) sets `ENABLE_PDF_VIEWER`.
- `enable_electron_extensions` (default `true`) sets `ENABLE_ELECTRON_EXTENSIONS`, which gates the extensions code in `shell/browser/extensions/`.
- `enable_builtin_spellchecker` (default `true`) sets `ENABLE_BUILTIN_SPELLCHECKER`.
- `enable_fake_location_provider` (default `!is_official_build`) sets `OVERRIDE_LOCATION_PROVIDER`, which mocks geolocation responses for tests. It should be off in release builds.
- `override_electron_version` sets the Electron version when the packager does not want the build to read the git tag.
- `electron_vendor_version` takes a `key:value` pair and adds it to `process.versions`. Its absence sets `HAS_VENDOR_VERSION=false`.

<!-- openwiki: broken internal link [/openwiki/architecture/javascript-api-layer.md] link "/openwiki/architecture/javascript-api-layer.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
The same header is consumed by the JavaScript side. The webpack template passes the path of `buildflags.h` to each bundle, and `webpack.config.base.js` turns its `#define BUILDFLAG_INTERNAL_*` lines into webpack `DefinePlugin` values, as covered in [JavaScript API Layer](/openwiki/architecture/javascript-api-layer.md). A flag therefore has one definition that both C++ and `lib/` see.

## Step 4: build with Ninja

```sh
ninja -C out/Testing electron
ninja -C out/Release electron
```

The `electron` target is a group in `BUILD.gn` (around line 1557). The `electron_lib` source set (around line 423 of `BUILD.gn`) is the main C++ library of the shell. The executable runs from `out/Testing` or `out/Release` (for example `out/Testing/electron` on Linux, `out/Testing/electron.exe` on Windows, and `out/Testing/Electron.app` on macOS).

Ninja pulls in several generated inputs. The order that matters is:

<!-- openwiki: broken internal link [/openwiki/architecture/api-docs-and-typings.md] link "/openwiki/architecture/api-docs-and-typings.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
1. **Typings.** The `build_electron_definitions` target runs the `gn-typescript-definitions` script, which regenerates `electron.d.ts` from `docs/api/` and `typings/`. See [API Documentation and Typings](/openwiki/architecture/api-docs-and-typings.md).
2. **Fuses.** The `electron_fuses` action runs `build/fuses/build.py` on `build/fuses/fuses.json5` to generate `fuses.h` and `fuses.cc`.
3. **Buildflags.** The `buildflags` header is generated from `buildflags/buildflags.gni`.
4. **JavaScript bundles.** Eight `webpack_build` targets, one per process type, compile `lib/` through `ts-loader` using `tsconfig.electron.json`. The `electron_js2c` action then embeds the bundles into `electron_natives.cc`.
5. **Default app.** The `default_app_js` target compiles `default_app/` with the `typescript_build` template.

The npm steps use the `npm_action` template in `build/npm.gni`. It runs `build/npm-run.py` after a pre-flight step that checks `package.json` and `yarn.lock` and stamps the result, so a dependency change forces the npm tasks to rerun.

Packaging uses a second group of targets. `ninja -C out/Release electron:electron_dist_zip` builds the distribution zip, and the same pattern builds `electron_chromedriver_zip`, `electron_mksnapshot_zip`, `electron_ffmpeg_zip`, and `hunspell_dictionaries_zip`. The contents of these zips are checked against manifests in `script/zip_manifests/`.

## Cross-compiling

Set `target_cpu` and `target_os` in the GN arguments to build for a different platform from the host, for example `target_cpu = "x86"` on an x64 host. `docs/development/build-instructions-gn.md` includes a table of host and target combinations and their status. Chromium does not support every combination.

## Failure modes and invariants

- A changed `DEPS` or `yarn.lock` reruns the affected npm and typings steps, because they are declared inputs. Changing the patch set without re-running `gclient sync` leaves the checked-out trees out of date.
- The `electron_js2c` action depends on every bundle, so a TypeScript error in `lib/` stops the natives step and the link.
- Changing `fuses.json5` changes the generated fuse accessors and therefore needs a rebuild of the C++ that reads them.
- Setting `is_official_build` changes webpack minification and the default for `enable_fake_location_provider`, so a release-profile build can behave differently from a testing one.
- The zip manifests assume the testing and release profiles produce the same file set. Changing an argument that adds or removes files breaks the manifest checks in CI.

## Related pages

<!-- openwiki: broken internal link [/openwiki/architecture/overview.md] link "/openwiki/architecture/overview.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Architecture Overview](/openwiki/architecture/overview.md) explains which parts of the build produce which layers.
<!-- openwiki: broken internal link [/openwiki/workflows/testing.md] link "/openwiki/workflows/testing.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Testing](/openwiki/workflows/testing.md) describes what to run once the build exists.
<!-- openwiki: broken internal link [/openwiki/architecture/chromium-and-upstream-patches.md] link "/openwiki/architecture/chromium-and-upstream-patches.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Chromium, Node, and Upstream Patches](/openwiki/architecture/chromium-and-upstream-patches.md) explains the patch hooks that run during sync.
<!-- openwiki: broken internal link [/openwiki/operations/ci-and-release.md] link "/openwiki/operations/ci-and-release.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [CI, Release, and Distribution](/openwiki/operations/ci-and-release.md) describes the automated version of these steps.
