---
title: "Build System"
---
## Overview

Electron is built as a Chromium target. The repository is checked out as `src/electron` inside a Chromium workspace, `gclient` fetches the pinned versions of Chromium, Node and the rest according to `DEPS`, patches are applied (see [[Patch System]]), and then GN and ninja build the `electron` group declared in `BUILD.gn`. This page explains what that file is made of, how source lists, JavaScript bundles, fuses and version headers are generated, and which GN arguments choose a configuration. Commands to run it are in [[Quickstart: Building and Running Electron]].

Sources: [docs/development/build-instructions-gn.md:15-30](repo://docs/development/build-instructions-gn.md#L15-L30), [BUILD.gn:1557-1559](repo://BUILD.gn#L1557-L1559)

## Dependencies and hooks

`DEPS` is the gclient file. Its `vars` pin `chromium_version`, `node_version` and the commits of `nan`, Squirrel.Mac, Mantle, ReactiveObjC and the reclient configs; switches such as `apply_patches` and `use_mtime_cache` are on by default, and `checkout_*` variables let in-house builds check components out manually. The `src` dependency itself is Chromium at the pinned version.

Sources: [DEPS:3-75](repo://DEPS#L3-L75), [DEPS:77-80](repo://DEPS#L77-L80)

Hooks run after checkout. The `pre_deps_hooks` entry generates an mtime cache with `patches-mtime-cache.py`; the `hooks` list applies all patches with `apply_all_patches.py` and the patch `config.json`, restores file times from the cache, and installs npm dependencies. The details of the patch scripts are in [[Patch System]].

Sources: [DEPS:112-160](repo://DEPS#L112-L160)

## GN arguments

`build/args/all.gn` holds arguments shared by every configuration, and `testing.gn` and `release.gn` import it and add their own: `release.gn` sets `is_component_build = false` and `is_official_build = true`, with a comment explaining that ffmpeg is a separate shared library (`is_component_ffmpeg = true`) so that users can swap out proprietary codecs. `all.gn` marks the build as Electron's with `is_electron_build = true`, pulls `//electron` in as a root dependency, and pins values like `node_module_version` and V8 flags.

Sources: [build/args/release.gn:1-9](repo://build/args/release.gn#L1-L9), [build/args/testing.gn:1-7](repo://build/args/testing.gn#L1-L7), [build/args/all.gn:1-14](repo://build/args/all.gn#L1-L14)

Feature switches live in `buildflags/buildflags.gni` as `declare_args`: `enable_pdf_viewer`, `enable_fake_location_provider` (default `!is_official_build`), `enable_electron_extensions`, `enable_builtin_spellchecker`, `override_electron_version` (so packagers can avoid the script that reads the git tag) and `electron_vendor_version`, which adds an entry to `process.versions`. These become `BUILDFLAG(...)` macros in C++ and, through the webpack configuration, constants in the JavaScript bundles (see [[Process Types and JavaScript Bootstraps]]).

Sources: [buildflags/buildflags.gni:5-30](repo://buildflags/buildflags.gni#L5-L30), [build/webpack/webpack.config.base.js:40-53](repo://build/webpack/webpack.config.base.js#L40-L53)

## BUILD.gn structure

`BUILD.gn` is long, but it is organized around a few kinds of targets:

Sources: [BUILD.gn:157-165](repo://BUILD.gn#L157-L165)

| Target kind | Examples | Purpose |
| --- | --- | --- |
| JavaScript bundles | `electron_browser_bundle`, `electron_renderer_bundle`, ... `electron_preload_realm_bundle` | One webpack build per `lib/` entry |
| Bundle embedding | `electron_js2c` | Compiles the bundles into `electron_natives.cc` |
| Generated headers | `electron_version_header`, `electron_fuses`, `electron_generate_node_defines` | Version, fuse wire and Node macro headers |
| Default app | `default_app_js`, `default_app_asar` | The app run when no app is given |
| The library | `electron_lib` | The `shell/` C++ as one source set |
| Executable and packaging | `electron_app`, `electron_dist_zip`, `electron` | The binary and its zips |

Sources: [BUILD.gn:157-272](repo://BUILD.gn#L157-L272), [BUILD.gn:283-316](repo://BUILD.gn#L283-L316), [BUILD.gn:341-358](repo://BUILD.gn#L341-L358), [BUILD.gn:393-436](repo://BUILD.gn#L393-L436), [BUILD.gn:1423-1447](repo://BUILD.gn#L1423-L1447)

Platform-specific dependencies are declared at the top of the file. On Linux, for example, `generate_library_loader("libnotify_loader")` produces a stub loader for libnotify's functions, so the binary does not link against the library, and `generate_stubs("electron_gtk_stubs")` produces GTK stubs from `.sigs` files. On macOS an `assert` pins `mac_deployment_target` to 12.0 and asks a developer who changes it to flag a breaking change.

Sources: [BUILD.gn:36-43](repo://BUILD.gn#L36-L43), [BUILD.gn:45-98](repo://BUILD.gn#L45-L98)

## Source lists: filenames.gni

C++ source files are not globbed. `filenames.gni` lists them: `lib_sources` for the common code and one list per platform. `electron_lib` starts from the common list and adds Windows, Mac, POSIX and Linux lists according to the target OS, and the toolkit-views list for every non-Mac platform. This is what makes the per-platform file pattern described in [[Native UI and OS Integration Modules]] work: adding `electron_api_foo_mac.mm` has no effect until it is added to `lib_sources_mac`.

Sources: [BUILD.gn:560-575](repo://BUILD.gn#L560-L575), [filenames.gni:24-25](repo://filenames.gni#L24-L25), [filenames.gni:122-134](repo://filenames.gni#L122-L134), [filenames.gni:236-240](repo://filenames.gni#L236-L240)

## JavaScript bundles

Each `webpack_build` target is created from a template. The template runs `webpack` through `npm_action` with the matching `webpack.config.<name>.js`, passes the generated buildflags header and a mode (`production` for official builds, otherwise `development`), declares the config, `tsconfig.json`, `yarn.lock` and the internal typings as inputs, and produces one `*.js` file under `gen/js2c`.

Sources: [build/webpack/webpack.gni:3-46](repo://build/webpack/webpack.gni#L3-L46)

`electron_js2c` depends on all eight bundles plus Node's `js2c` tool, and runs `build/js2c.py` over the bundle files to write `electron_natives.cc`, making the bundles available to the binary under their `electron/js2c/<name>` identifiers (see [[Main Process Startup]] and [[Process Types and JavaScript Bootstraps]]).

Sources: [BUILD.gn:237-272](repo://BUILD.gn#L237-L272)

Ninja needs to know which TypeScript files each bundle depends on, so a bundle is rebuilt when any of them change. That list is generated into `filenames.auto.gni` (marked "AUTO-GENERATED, PLEASE DO NOT EDIT BY HAND") by `script/gen-filenames.ts`. For each webpack config it runs webpack with `--env PRINT_WEBPACK_GRAPH`, which swaps in an `AccessDependenciesPlugin` that prints every module path; the script keeps files inside the repository and outside `node_modules`, adds `tsconfig.json`, `tsconfig.electron.json`, `package.json` and the typings, sorts them, and also records every `docs/api` file as `api_docs`. Each `webpack_build` target in `BUILD.gn` uses the matching `auto_filenames.*_bundle_deps` list as its inputs.

Sources: [script/gen-filenames.ts:18-113](repo://script/gen-filenames.ts#L18-L113), [build/webpack/webpack.config.base.js:10-19](repo://build/webpack/webpack.config.base.js#L10-L19), [build/webpack/webpack.config.base.js:59-61](repo://build/webpack/webpack.config.base.js#L59-L61), [BUILD.gn:165-172](repo://BUILD.gn#L165-L172)

## Fuses

Fuses are build-time flags stored in the binary so they can be flipped later without recompiling. `build/fuses/fuses.json5` names each fuse and its default (`"1"` on, `"0"` off, `"r"` removed). The `electron_fuses` action runs `build/fuses/build.py`, which generates `fuses.h` and `fuses.cc`. The `.cc` file defines `kFuseWire`, a `volatile` byte array starting with a fixed sentinel string, the schema version and the wire length, followed by one character per fuse. Each fuse gets an exported getter `Is<CamelCaseName>Enabled()` that reads its position in the wire. In `DCHECK` builds a getter first checks for a `--set-fuse-<name>` switch, which lets tests override a fuse, except that the code skips the switch when the command line is not yet initialized (the `RunAsNode` check is that early).

Sources: [build/fuses/fuses.json5:1-13](repo://build/fuses/fuses.json5#L1-L13), [BUILD.gn:393-404](repo://BUILD.gn#L393-L404), [build/fuses/build.py:10-49](repo://build/fuses/build.py#L10-L49), [build/fuses/build.py:62-88](repo://build/fuses/build.py#L62-L88)

The wire begins with a fixed sentinel string, so it can be located in a compiled binary. The file's schema comment says a breaking schema change must bump `_version`, and a fuse is never removed or reinterpreted but only marked `r`; the script refuses a version above one byte. Code reads fuses through those getters, for example `IsRunAsNodeEnabled()` in `main` and `IsOnlyLoadAppFromAsarEnabled()` in `NodeBindings`; see [[Main Process Startup]] and [[ASAR Archives]].

Sources: [build/fuses/fuses.json5:2-4](repo://build/fuses/fuses.json5#L2-L4), [build/fuses/build.py:54-60](repo://build/fuses/build.py#L54-L60), [shell/app/electron_main_linux.cc:36-40](repo://shell/app/electron_main_linux.cc#L36-L40), [shell/common/node_bindings.cc:680-700](repo://shell/common/node_bindings.cc#L680-L700)

## Version and other generated files

The Electron version is produced by an `npm_action` that runs `generate-version-json` to write `electron_version.args`; a `templated_file` target fills `build/templates/electron_version.tmpl` into `electron_version.h`. `electron_generate_node_defines` reads three Node headers and writes `push_and_undef_node_defines.h` and `pop_node_defines.h`, generated header pair that `node_includes.h` uses (it includes `electron/pop_node_defines.h` after Node's headers). The `generate_config_gypi` action runs `script/generate-config-gypi.py` to produce `config.gypi`, which the `node_gypi_headers` target copies into the Node headers package. The app's name, product name and macOS bundle id come from `shell/app/BRANDING.json`.

Sources: [BUILD.gn:341-358](repo://BUILD.gn#L341-L358), [BUILD.gn:406-421](repo://BUILD.gn#L406-L421), [BUILD.gn:274-279](repo://BUILD.gn#L274-L279), [BUILD.gn:1574-1581](repo://BUILD.gn#L1574-L1581), [BUILD.gn:100-103](repo://BUILD.gn#L100-L103), [shell/common/node_includes.h:25-35](repo://shell/common/node_includes.h#L25-L35)

## Distribution

`electron_dist_zip` builds the distributable zip with a `dist_zip` template; similar targets zip ffmpeg, chromedriver, mksnapshot, hunspell dictionaries and libc++ headers. These artifacts are what the release scripts upload; see [[Release Process]]. The `electron` group simply depends on `electron_app`, which on macOS is a `mac_app_bundle` containing the framework, helper apps and resources.

Sources: [BUILD.gn:1364-1405](repo://BUILD.gn#L1364-L1405), [BUILD.gn:1423-1500](repo://BUILD.gn#L1423-L1500), [BUILD.gn:1099-1115](repo://BUILD.gn#L1099-L1115)
