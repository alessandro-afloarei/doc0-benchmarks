---
title: "Build System and Patches"
---
## Overview

Electron is not a standalone project. It is the `src/electron` directory inside a Chromium checkout, built by Chromium's own tools: `gclient` fetches the dependencies, GN generates ninja files, and ninja compiles Chromium, Node.js and Electron as one build. Where upstream code does not fit, Electron carries ordered patch series that are applied to the checked-out dependencies on every sync.

Sources: [DEPS:79-110](repo://DEPS#L79-L110), [DEPS:129-139](repo://DEPS#L129-L139), [patches/config.json:1-16](repo://patches/config.json#L1-L16)

The commands to check out and build are in [[Quickstart: Build and Run Electron]]. The JavaScript bundles built by GN are covered in [[Internal JavaScript Bundles]], and the fuse wire in [[Fuses]]. This page explains the structure those pieces fit into.

Sources: [BUILD.gn:165-273](repo://BUILD.gn#L165-L273), [BUILD.gn:393-401](repo://BUILD.gn#L393-L401)

## DEPS: what gets checked out

`DEPS` pins every external dependency by version or commit. The `vars` block names `chromium_version`, `node_version`, and commit hashes for nan, Squirrel.Mac, ReactiveObjC, Mantle and the EngFlow reclient configs. The `deps` block maps each one to a path in the checkout: Chromium to `src`, Node.js to `src/third_party/electron_node`, and the Squirrel.Mac family under `src/third_party/squirrel.mac`. Each entry has a condition such as `checkout_node`, so in-house builds can supply their own copy.

Sources: [DEPS:1-17](repo://DEPS#L1-L17), [DEPS:42-47](repo://DEPS#L42-L47), [DEPS:79-110](repo://DEPS#L79-L110)

`DEPS` also runs hooks after the sync.

Sources: [DEPS:112-139](repo://DEPS#L112-L139)

1. `generate_mtime_cache` (a pre-deps hook) records the modification times of files the patches touch.
2. `patch_chromium` runs `apply_all_patches.py` with `patches/config.json`.
3. `apply_mtime_cache` restores the recorded times. The `use_mtime_cache` variable's comment says this speeds up builds, since re-applying identical patches would otherwise make every patched file look new.
4. `electron_npm_deps` installs the repository's npm packages, and the `sysroot_*` hooks install Linux sysroots for each target architecture.

Sources: [DEPS:36-40](repo://DEPS#L36-L40), [DEPS:112-213](repo://DEPS#L112-L213)

## Patches

### Layout

`patches/config.json` lists one entry per patched project: a `patch_dir` inside `src/electron/patches` and the `repo` it applies to. The entries cover Chromium, BoringSSL, DevTools frontend, FFmpeg, V8, Node.js, nan, Perfetto, Squirrel.Mac with ReactiveObjC and Mantle, WebRTC, the reclient configs and SQLite.

Sources: [patches/config.json:1-16](repo://patches/config.json#L1-L16)

Each patch directory holds `.patch` files plus a `.patches` file that lists them in application order. The development guide explains the choice of a list file over numeric prefixes: it avoids two pull requests both adding patch `NNN-` and reduces churn when patches are added or removed in the middle. Each patch is a `git format-patch` file whose commit message says why it exists. `can_create_window.patch`, for example, adds the hook Electron's `CanCreateWindow` relies on.

Sources: [docs/development/patches.md:19-39](repo://docs/development/patches.md#L19-L39), [patches/chromium/.patches:1-5](repo://patches/chromium/.patches#L1-L5), [patches/chromium/can_create_window.patch:1-20](repo://patches/chromium/can_create_window.patch#L1-L20)

### Applying

`apply_all_patches.py` reads each config file and, for each target that exists on disk, calls `git.import_patches` with the series from `patch_from_dir`. The commits are made as committer "Electron Scripts". Setting `ELECTRON_USE_THREE_WAY_MERGE_FOR_PATCHES` makes `git am` use a three-way merge.

Sources: [script/apply_all_patches.py:1-45](repo://script/apply_all_patches.py#L1-L45)

`patch_from_dir` reads `.patches` and concatenates the listed files. As it reads each one, `read_patch` inserts `Patch-Dir:` and `Patch-Filename:` lines into the commit message, just before the diff. Those lines record which file each commit came from, so a later export can write it back under the same name.

Sources: [script/lib/patches.py:1-40](repo://script/lib/patches.py#L1-L40)

`import_patches` first points `refs/patches/upstream-head` at the current `HEAD`, then runs `git am` with `--keep-cr`, so patches against CRLF files apply. That ref marks where upstream ends and Electron's patch commits begin.

Sources: [script/lib/git.py:21-21](repo://script/lib/git.py#L21-L21), [script/lib/git.py:53-70](repo://script/lib/git.py#L53-L70), [script/lib/git.py:81-85](repo://script/lib/git.py#L81-L85)

### Editing and exporting

Changing a patch means editing the dependency's git history and exporting it again. A developer commits in the dependency (or fixes up and rebases an existing patch commit) and runs `git-export-patches -o <patch_dir>`. `export_all_patches.py` does the same for every entry in `config.json`. To remove a patch, they delete it from `.patches`, reset the dependency to `refs/patches/upstream-head`, re-import and re-export.

Sources: [docs/development/patches.md:43-80](repo://docs/development/patches.md#L43-L80), [script/git-export-patches:1-25](repo://script/git-export-patches#L1-L25), [script/export_all_patches.py:1-48](repo://script/export_all_patches.py#L1-L48)

`git.export_patches` finds the patch range from the upstream-head ref when none is given, runs `format-patch`, and splits the output into patches. In normal mode it deletes the old `.patch` files, so a dropped commit disappears, then writes the patches and a new `.patches`. In `--dry-run` mode it compares each formatted patch with the file on disk and exits with an error listing those that are out of date, which is how a check can catch a forgotten re-export.

Sources: [script/lib/git.py:224-280](repo://script/lib/git.py#L224-L280)

`git-import-patches <patch_dir>` imports a single series into the current repository, with `-3` for a three-way merge.

Sources: [script/git-import-patches:1-27](repo://script/git-import-patches#L1-L27)

## BUILD.gn: what gets built

### Main targets

`BUILD.gn` at the repository root defines Electron's targets on top of Chromium's.

Sources: [BUILD.gn:28-32](repo://BUILD.gn#L28-L32)

| Target | What it is |
| --- | --- |
| `electron_lib` | The `source_set` with all of `shell/`, depending on the JS bundles (`electron_js2c`), fuses, the version header, resources, buildflags, `chromium_src:chrome` and the Mojo interfaces |
| `electron_app` | The executable on Windows and Linux, or the `mac_app_bundle` on macOS with helpers such as `electron_login_helper` |
| `electron` | A group over `electron_app`, the target `ninja -C out/Testing electron` builds |
| `electron_dist_zip` and other `dist_zip` targets | Distribution zips: Electron itself, FFmpeg, chromedriver, mksnapshot, hunspell dictionaries, libc++ headers |
| `node_headers` | Node headers for building native modules, used by the spec runner |

Sources: [BUILD.gn:423-470](repo://BUILD.gn#L423-L470), [BUILD.gn:1099-1100](repo://BUILD.gn#L1099-L1100), [BUILD.gn:1209-1210](repo://BUILD.gn#L1209-L1210), [BUILD.gn:1364-1364](repo://BUILD.gn#L1364-L1364), [BUILD.gn:1423-1500](repo://BUILD.gn#L1423-L1500), [BUILD.gn:1557-1559](repo://BUILD.gn#L1557-L1559), [BUILD.gn:1618-1618](repo://BUILD.gn#L1618-L1618)

### Source lists

C++ source lists are kept out of `BUILD.gn` in `.gni` files. `filenames.gni` defines `lib_sources` and the platform lists `lib_sources_win`, `lib_sources_mac`, `lib_sources_linux` and `lib_sources_views`, plus the default app's files. `electron_lib` starts from `filenames.lib_sources` and adds the platform lists.

Sources: [filenames.gni:1-30](repo://filenames.gni#L1-L30), [BUILD.gn:560-566](repo://BUILD.gn#L560-L566)

`filenames.auto.gni` is generated and marked "do not edit". `script/gen-filenames.ts` asks every webpack config for its dependency graph, keeps only the repository's own files, adds the tsconfig, `package.json` and typings files every bundle depends on, and writes one sorted list per bundle. It also lists `docs/api` files for the type definitions. GN uses those lists as inputs so ninja knows when to rebuild a bundle.

Sources: [script/gen-filenames.ts:1-100](repo://script/gen-filenames.ts#L1-L100), [filenames.auto.gni:1-5](repo://filenames.auto.gni#L1-L5)

### Build flags

`buildflags/buildflags.gni` declares Electron's GN arguments: `enable_pdf_viewer`, `enable_electron_extensions` and `enable_builtin_spellchecker` (all on), `enable_fake_location_provider` (on except in official builds), `override_electron_version` for packagers who should not depend on git tags, and `electron_vendor_version`, an extra `key:value` shown in `process.versions`. `buildflags/BUILD.gn` turns them into the `buildflags.h` header with `BUILDFLAG(...)` macros, which C++ checks and the webpack config also reads.

Sources: [buildflags/buildflags.gni:5-30](repo://buildflags/buildflags.gni#L5-L30), [buildflags/BUILD.gn:5-28](repo://buildflags/BUILD.gn#L5-L28), [build/webpack/webpack.config.base.js:44-53](repo://build/webpack/webpack.config.base.js#L44-L53)

### chromium_src

Some Electron features need Chrome code that is not part of the content layer. Instead of copying it, `chromium_src/BUILD.gn` builds selected files straight from the Chromium tree into a static library, `chrome`, visible only to `electron_lib`. It covers parts of the browser process, DevTools support, icon loading and more.

Sources: [chromium_src/BUILD.gn:1-40](repo://chromium_src/BUILD.gn#L1-L40)

### Build arguments

`build/args/testing.gn` and `build/args/release.gn` both import `all.gn` and differ in debug, DCHECK and symbol settings, as the quickstart shows. The `electron_version_*` templates and the `electron_fuses` and `electron_js2c` actions generate the remaining inputs, so a clean `gn gen` plus `ninja` produces everything from the checkout.

Sources: [build/args/testing.gn:1-7](repo://build/args/testing.gn#L1-L7), [build/args/release.gn:1-9](repo://build/args/release.gn#L1-L9), [BUILD.gn:351-401](repo://BUILD.gn#L351-L401)
