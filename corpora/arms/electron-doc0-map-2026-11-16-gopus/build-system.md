---
title: "Build System, Patches and JS Bundling"
---
## Overview

Electron is built as one more directory, `src/electron`, inside a Chromium checkout, using Chromium's own tools: `gclient` fetches dependencies listed in `DEPS`, GN generates ninja files from `BUILD.gn`, and ninja builds. On top of that toolchain Electron adds four things this page covers: patch sets applied to Chromium, Node.js and other dependencies after checkout; webpack bundles of the TypeScript in `lib/` that are compiled into the binary; "fuses", a block of flags in the binary that packagers can flip after the build; and GN build flags for optional features. How to run a build is on [[Building, Running and Testing Electron]].

Sources: [DEPS:1-110](repo://DEPS#L1-L110), [BUILD.gn:165-272](repo://BUILD.gn#L165-L272), [BUILD.gn:393-404](repo://BUILD.gn#L393-L404)

## Checkout: DEPS

### Pinned dependencies

`DEPS` pins Chromium by version (`chromium_version`) and Node.js by tag (`node_version`, checked out as `src/third_party/electron_node`), plus `nan`, Squirrel.Mac with ReactiveObjC and Mantle, and EngFlow's reclient configs, each by commit. Variables let in-house builds skip parts of the checkout (`checkout_chromium`, `checkout_node`, `checkout_nan`) or turn off patching (`apply_patches`) and the mtime cache (`use_mtime_cache`).

Sources: [DEPS:3-75](repo://DEPS#L3-L75), [DEPS:77-110](repo://DEPS#L77-L110)

### Hooks

After sync, `gclient` runs Electron's hooks in order. Before deps are fetched, `generate_mtime_cache` records file modification times for patched files. Then `patch_chromium` runs `script/apply_all_patches.py` with `patches/config.json`, `apply_mtime_cache` restores the recorded mtimes so files whose content did not change are not rebuilt, `electron_npm_deps` runs `yarn install --frozen-lockfile` in `src/electron`, and the Linux sysroot hooks install sysroots per architecture.

Sources: [DEPS:112-160](repo://DEPS#L112-L160), [DEPS:162-205](repo://DEPS#L162-L205)

## Patches

### Layout

Electron prefers to use upstream code unchanged; the project's guide accepts a patch only if it is temporary and headed upstream, needed to compile in Electron and impossible to upstream, or an Electron-specific behaviour change fundamentally incompatible with upstream. `patches/config.json` maps each patch directory to the repository it applies to: Chromium (`src`), BoringSSL, DevTools front end, FFmpeg, V8, Node, nan, Perfetto, Squirrel.Mac and its vendored libraries, WebRTC, reclient configs and SQLite. Each directory holds `.patch` files and a `.patches` file listing their order.

Sources: [docs/development/patches.md:1-35](repo://docs/development/patches.md#L1-L35), [patches/config.json:1-16](repo://patches/config.json#L1-L16)

The guide gives the reason for a separate order file instead of numbered file names: two pull requests that both append a patch would otherwise collide on the same number, and inserting or deleting a patch in the middle would renumber the rest.

Sources: [docs/development/patches.md:37-39](repo://docs/development/patches.md#L37-L39)

### Applying and editing

`apply_all_patches.py` reads each config and, for each target repository that exists, imports its patch series as commits authored by "Electron Scripts"; setting `ELECTRON_USE_THREE_WAY_MERGE_FOR_PATCHES` makes the import use three-way merges. The patch files are read in `.patches` order by `patch_from_dir`.

Sources: [script/apply_all_patches.py:11-45](repo://script/apply_all_patches.py#L11-L45), [script/lib/patches.py:31-34](repo://script/lib/patches.py#L31-L34)

Because the patches become ordinary commits, editing them is a git workflow: commit a change in the patched repository and run `script/git-export-patches -o <patch dir>` to regenerate the files and `.patches`; amend an existing patch with a `--fixup` commit and an autosquash rebase before exporting; remove one by deleting its line, resetting to `refs/patches/upstream-head`, and re-importing and re-exporting. The commit subject becomes the patch file name and the body should explain why the patch exists.

Sources: [docs/development/patches.md:41-80](repo://docs/development/patches.md#L41-L80)

## GN targets

### The main targets

`BUILD.gn` builds the C++ in `shell/` as the `electron_lib` source set. It depends on the generated fuses, Node define headers, the embedded JS (`electron_js2c`), the version header, GRIT resources, the build flags, the forked Chrome code in `chromium_src`, and the mojo interfaces. The platform executable `electron_app` (a Mac app bundle with a login helper on macOS) links it, and the `electron` group builds the app.

Sources: [BUILD.gn:423-453](repo://BUILD.gn#L423-L453), [BUILD.gn:1040](repo://BUILD.gn#L1040), [BUILD.gn:1099](repo://BUILD.gn#L1099), [BUILD.gn:1209](repo://BUILD.gn#L1209), [BUILD.gn:1557-1558](repo://BUILD.gn#L1557-L1558)

| Target | What it produces |
| --- | --- |
| `build_electron_definitions` | `electron.d.ts` generated from `docs/api` (used by the TypeScript build and the IDE) |
| `electron_*_bundle` | One webpack bundle per process type |
| `electron_js2c` | `electron_natives.cc` with the bundles embedded |
| `default_app_asar` | `resources/default_app.asar` from `default_app/` |
| `resources` | `electron_resources.pak` via GRIT |
| `electron_version_header`, `electron_win_rc`, `electron_version_file` | Version header, Windows resource script, `version` file |
| `electron_fuses` | `fuses.h` and `fuses.cc` |
| `electron_dist_zip` and other `dist_zip` targets | Distribution zips of the app, ffmpeg, chromedriver, mksnapshot, dictionaries, libc++ headers |

Sources: [BUILD.gn:152-163](repo://BUILD.gn#L152-L163), [BUILD.gn:237-272](repo://BUILD.gn#L237-L272), [BUILD.gn:303-404](repo://BUILD.gn#L303-L404), [BUILD.gn:1364](repo://BUILD.gn#L1364), [BUILD.gn:1423-1425](repo://BUILD.gn#L1423-L1425), [BUILD.gn:1448-1539](repo://BUILD.gn#L1448-L1539)

### Source lists

`filenames.gni` lists the C++ and Objective-C sources by platform (`lib_sources`, `lib_sources_mac`, `lib_sources_win`, `lib_sources_linux`, `lib_sources_views`, `lib_sources_extensions` and others) and the default app's files; new API files are added there by hand. `filenames.auto.gni` is generated and must not be edited: `script/gen-filenames.ts` lists every `docs/api` page and, for each webpack target, runs webpack with `PRINT_WEBPACK_GRAPH` to record every file the bundle includes, so GN knows when to rebuild a bundle. The lint-staged pre-commit hook regenerates it.

Sources: [filenames.gni:1-24](repo://filenames.gni#L1-L24), [filenames.gni:236](repo://filenames.gni#L236), [filenames.auto.gni:1-12](repo://filenames.auto.gni#L1-L12), [script/gen-filenames.ts:1-75](repo://script/gen-filenames.ts#L1-L75), [package.json:101-108](repo://package.json#L101-L108)

## JS bundling

### webpack_build

The `webpack_build` GN template runs webpack through `npm_action` with the target's config, an output file under `$target_gen_dir/js2c`, the generated `buildflags.h`, and `mode=production` for official builds (`development` otherwise). Its inputs include the base config, `tsconfig.json`, `yarn.lock` and the internal typings, so any of those changing rebuilds every bundle.

Sources: [build/webpack/webpack.gni:3-46](repo://build/webpack/webpack.gni#L3-L46)

### The base config

`webpack.config.base.js` takes per-target options and builds the config. The entry is `lib/<target>/init.ts`. `@electron/internal` aliases `lib/`, and `electron`, `electron/main`, `electron/renderer`, `electron/common` and `electron/utility` all resolve to `lib/<target or alternate>/api/exports/electron.ts`. TypeScript goes through `ts-loader` with `tsconfig.electron.json`. Production builds are minified with Terser keeping class and function names.

Sources: [build/webpack/webpack.config.base.js:21-38](repo://build/webpack/webpack.config.base.js#L21-L38), [build/webpack/webpack.config.base.js:109-171](repo://build/webpack/webpack.config.base.js#L109-L171)

Each `#define BUILDFLAG_INTERNAL_<NAME>() (0|1)` line in `buildflags.h` becomes a compile-time constant through `DefinePlugin`, so TypeScript can test `BUILDFLAG(ENABLE_...)` and dead branches drop out. `ProvidePlugin` injects `Buffer`, `global` and `process` from `webpack-provider` for targets that delete Node globals, browser polyfills for targets without Node, and a captured `Promise` for every target.

Sources: [build/webpack/webpack.config.base.js:40-83](repo://build/webpack/webpack.config.base.js#L40-L83)

### Per-target options

| Bundle | `alwaysHasNode` | Other options |
| --- | --- | --- |
| `browser` | yes | none |
| `renderer` | yes | deletes Node globals, profiling wrapper, try/catch wrapper |
| `worker` | yes | uses the renderer's `electron` exports, deletes Node globals, try/catch wrapper |
| `sandboxed_renderer` | no | profiling wrapper, try/catch wrapper |
| `isolated_renderer` | no | try/catch wrapper |
| `preload_realm` | no | profiling wrapper, try/catch wrapper |
| `node` | yes | none |
| `utility` | yes | none |

Sources: [build/webpack/webpack.config.browser.js:1-4](repo://build/webpack/webpack.config.browser.js#L1-L4), [build/webpack/webpack.config.renderer.js:1-7](repo://build/webpack/webpack.config.renderer.js#L1-L7), [build/webpack/webpack.config.worker.js:1-7](repo://build/webpack/webpack.config.worker.js#L1-L7), [build/webpack/webpack.config.sandboxed_renderer.js:1-6](repo://build/webpack/webpack.config.sandboxed_renderer.js#L1-L6), [build/webpack/webpack.config.isolated_renderer.js:1-5](repo://build/webpack/webpack.config.isolated_renderer.js#L1-L5), [build/webpack/webpack.config.preload_realm.js:1-6](repo://build/webpack/webpack.config.preload_realm.js#L1-L6), [build/webpack/webpack.config.node.js:1-4](repo://build/webpack/webpack.config.node.js#L1-L4), [build/webpack/webpack.config.utility.js:1-4](repo://build/webpack/webpack.config.utility.js#L1-L4)

The try/catch wrapper logs `Electron <bundle> script failed to run` instead of throwing into Blink, and the profiling wrapper defers the whole bundle with `setTimeout` when `--profile-electron-init` is passed, so a profiler can attach first.

Sources: [build/webpack/webpack.config.base.js:85-107](repo://build/webpack/webpack.config.base.js#L85-L107)

### Embedding with js2c

`electron_js2c` runs Node's own `js2c` tool (built for the host toolchain) over the eight bundles with `--only-js`, producing `electron_natives.cc`, which registers each bundle as a Node builtin with an id like `electron/js2c/browser_init`. At run time `util::CompileAndCall` looks the id up with Node's `BuiltinLoader`, compiles it as a function with the given parameter names (such as `process` and `require`, or `binding`) and calls it; the comment notes errors there are rare because every bundle is wrapped in `try`. `NodeBindings` passes `electron/js2c/<type>_init` as Node's main script, and the renderer clients call `CompileAndCall` for the sandbox, isolated and preload realm bundles ([[Node.js Integration and Event Loop]], [[Sandboxed Renderers and Preload Realm]]).

Sources: [BUILD.gn:237-272](repo://BUILD.gn#L237-L272), [build/js2c.py:7-17](repo://build/js2c.py#L7-L17), [shell/common/node_util.cc:23-59](repo://shell/common/node_util.cc#L23-L59), [shell/common/node_bindings.cc:702-704](repo://shell/common/node_bindings.cc#L702-L704)

## Fuses

### The fuse wire

`fuses.json5` lists each fuse with `"0"` (off), `"1"` (on) or `"r"` (removed), and a `_version`. `build/fuses/build.py` turns it into a `kFuseWire` byte array: a fixed 32-character sentinel, the version byte, the number of fuses, then one ASCII byte per fuse in file order. The array is `volatile` so the compiler cannot fold the values away, which is what lets tools find the sentinel in the shipped binary and flip bytes after the build. The schema comment requires bumping `_version` for breaking changes and forbids removing a fuse or changing its meaning; obsolete ones are marked `r`.

Sources: [build/fuses/fuses.json5:1-13](repo://build/fuses/fuses.json5#L1-L13), [build/fuses/build.py:10-111](repo://build/fuses/build.py#L10-L111)

For each fuse the script generates an `Is<Name>Enabled()` getter that reads its byte. In DCHECK builds a `--set-fuse-<name>=1` switch overrides the byte, guarded because `run_as_node` is checked before the command line exists.

Sources: [build/fuses/build.py:62-88](repo://build/fuses/build.py#L62-L88)

### Where fuses are read

| Fuse | Read by |
| --- | --- |
| `run_as_node` | Platform `main()` before honouring `ELECTRON_RUN_AS_NODE` |
| `node_options` | `NodeMain` and `SetNodeOptions` |
| `node_cli_inspect` | `IsAllowedOption` and the debug signal handler |
| `embedded_asar_integrity_validation` | `asar::Archive` |
| `only_load_app_from_asar` | The app search paths |
| `load_browser_process_specific_v8_snapshot` | `GetBrowserV8SnapshotFilename` |
| `grant_file_protocol_extra_privileges` | `ProtocolRegistry` and `RendererClientBase` |

Sources: [shell/app/electron_main_linux.cc:36-40](repo://shell/app/electron_main_linux.cc#L36-L40), [shell/app/node_main.cc:127-131](repo://shell/app/node_main.cc#L127-L131), [shell/common/node_bindings.cc:386-387](repo://shell/common/node_bindings.cc#L386-L387), [shell/common/asar/archive.cc:234-237](repo://shell/common/asar/archive.cc#L234-L237), [shell/common/node_bindings.cc:680-700](repo://shell/common/node_bindings.cc#L680-L700), [shell/app/electron_main_delegate.cc:436-444](repo://shell/app/electron_main_delegate.cc#L436-L444), [shell/browser/protocol_registry.cc:26-41](repo://shell/browser/protocol_registry.cc#L26-L41)

## Build flags

`buildflags/buildflags.gni` declares the GN arguments for optional features: `enable_pdf_viewer`, `enable_electron_extensions`, `enable_builtin_spellchecker` (all on by default), `enable_fake_location_provider` (on for non-official builds only), `override_electron_version` (so packagers need not run the git-tag script) and `electron_vendor_version` (an extra `key:value` shown in `process.versions`). `buildflags/BUILD.gn` turns them into `buildflags.h` for C++'s `BUILDFLAG(...)` checks, splitting the vendor version into a name and a value; the same header feeds webpack's `DefinePlugin`, so C++ and TypeScript see the same flags.

Sources: [buildflags/buildflags.gni:5-30](repo://buildflags/buildflags.gni#L5-L30), [buildflags/BUILD.gn:8-28](repo://buildflags/BUILD.gn#L8-L28), [build/webpack/webpack.gni:37-42](repo://build/webpack/webpack.gni#L37-L42), [shell/common/node_bindings.cc:1004-1012](repo://shell/common/node_bindings.cc#L1004-L1012)
