---
title: "Building from Source"
---
## Overview

Electron is built with GN and Ninja inside a Chromium checkout. `DEPS` pins the Chromium and Node.js versions that the checkout uses, the root `BUILD.gn` declares Electron's targets, and `build/args/*.gn` holds the configurations that decide how each output is built.

Sources: [DEPS:3-8](repo://DEPS#L3-L8), [DEPS:78-80](repo://DEPS#L78-L80), [BUILD.gn:1-32](repo://BUILD.gn#L1-L32)

The root `BUILD.gn` imports Chromium's and Node's GN files together with Electron's own `build/*.gni` files and the source lists in `filenames.gni` and `filenames.auto.gni`. The source lists tell GN which files each target compiles.

Sources: [BUILD.gn:19-29](repo://BUILD.gn#L19-L29), [filenames.gni:236-238](repo://filenames.gni#L236-L238)

## Pinned versions

`DEPS` sets `chromium_version` to `141.0.7361.0` and `node_version` to `v22.18.0`. The `src` entry checks out Chromium at that version, and the Node entry checks out Node at `node_version`.

Sources: [DEPS:3-8](repo://DEPS#L3-L8), [DEPS:78-80](repo://DEPS#L78-L80), [DEPS:85-88](repo://DEPS#L85-L88)

## Build configurations

`build/args/all.gn` is the shared base. It sets `is_electron_build`, adds `//electron` as a root dependency, pins the Node module version, and turns on the promise internal field and the JavaScript promise hooks.

Sources: [build/args/all.gn:1-14](repo://build/args/all.gn#L1-L14)

The Testing configuration imports the base and builds without official settings, with `dcheck_always_on` and `symbol_level = 1`. The Release configuration sets `is_official_build` and builds ffmpeg as a shared library.

Sources: [build/args/testing.gn:1-7](repo://build/args/testing.gn#L1-L7), [build/args/release.gn:1-9](repo://build/args/release.gn#L1-L9)

The build guide creates an output directory with `gn gen` and an args file, and then builds with `ninja -C out/Testing electron`. The same steps work for Release with its own directory.

Sources: [docs/development/build-instructions-gn.md:127](repo://docs/development/build-instructions-gn.md#L127), [docs/development/build-instructions-gn.md:145](repo://docs/development/build-instructions-gn.md#L145), [docs/development/build-instructions-gn.md:169](repo://docs/development/build-instructions-gn.md#L169), [docs/development/build-instructions-gn.md:175](repo://docs/development/build-instructions-gn.md#L175)

## Targets

| Target | What it builds | Defined at |
| --- | --- | --- |
| `electron` | group that depends on the app target | [BUILD.gn:1557-1559](repo://BUILD.gn#L1557-L1559) |
| `electron_lib` | source set from the `lib_sources` list | [BUILD.gn:423-425](repo://BUILD.gn#L423-L425) |
| `electron_js2c` | the JavaScript bundles as C++ sources | [BUILD.gn:237-240](repo://BUILD.gn#L237-L240) |
| `electron_fuses` | fuse getters, from `build/fuses/build.py` | [BUILD.gn:393-398](repo://BUILD.gn#L393-L398) |
| `default_app_asar` | the default app packed as an asar | [BUILD.gn:303](repo://BUILD.gn#L303) |
| `electron_dist_zip` | the distribution archive | [BUILD.gn:1423-1426](repo://BUILD.gn#L1423-L1426) |

Sources: [BUILD.gn:237-240](repo://BUILD.gn#L237-L240), [BUILD.gn:303](repo://BUILD.gn#L303), [BUILD.gn:393-398](repo://BUILD.gn#L393-L398), [BUILD.gn:423-425](repo://BUILD.gn#L423-L425), [BUILD.gn:1423-1426](repo://BUILD.gn#L1423-L1426), [BUILD.gn:1557-1559](repo://BUILD.gn#L1557-L1559)

`lib_sources` lists the C++ files that make up Electron's core. The `electron_lib` source set starts from that list and adds the Windows, Mac and POSIX lists for the matching platforms. GN compiles only the files that these lists name, so a new C++ file has to be added to one of them.

Sources: [filenames.gni:236-238](repo://filenames.gni#L236-L238), [BUILD.gn:560-568](repo://BUILD.gn#L560-L568)

The `branding` config defines `ELECTRON_PRODUCT_NAME` and `ELECTRON_PROJECT_NAME` as preprocessor macros, which the C++ code reads.

Sources: [BUILD.gn:141-147](repo://BUILD.gn#L141-L147)

The JavaScript bundles and the fuse getters are built by separate targets. [[Bundling the JavaScript Layer]] describes the JavaScript build, and [[ASAR Archives and Fuses]] describes the fuses. The patch set that Electron keeps against Chromium and Node is covered in [[Patches to Chromium and Node]].

Sources: [BUILD.gn:165-166](repo://BUILD.gn#L165-L166), [BUILD.gn:393-398](repo://BUILD.gn#L393-L398)
