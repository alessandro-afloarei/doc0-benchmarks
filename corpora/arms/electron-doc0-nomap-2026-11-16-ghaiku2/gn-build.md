---
title: "GN Build"
---
## Overview

The native code is built by GN and Ninja, inside a Chromium checkout. The Electron repository is the `electron` directory of that checkout, and its `BUILD.gn` adds Electron's targets to the Chromium build. The build pins the exact Chromium and Node.js versions, applies the patches, and produces the app and its helper binaries. This page covers the targets that the build defines, the argument files that configure a build, and how the version pins are declared. The JavaScript bundles that the build also produces are in [[JavaScript Bundles]], and the patch workflow is in [[Patching Upstream Projects]].

Sources: [BUILD.gn:1-29](repo://BUILD.gn#L1-L29)

## Version pins

`DEPS` pins Chromium to `chromium_version` and Node.js to `node_version`. `gclient` reads these values when it syncs the checkout.

Sources: [DEPS:4-22](repo://DEPS#L4-L22)

The Squirrel.Mac, ReactiveObjC and Mantle revisions are fetched into `third_party/squirrel.mac` for the macOS build.

Sources: [DEPS:94-103](repo://DEPS#L94-L103)

The Chromium source is fetched at the pinned version through the `url` entry for `src`.

Sources: [DEPS:79-79](repo://DEPS#L79-L79)

## Argument files

Each build configuration is a GN file that imports `build/args/all.gn` and adds its own flags. `all.gn` sets `is_electron_build`, pulls in the Electron root as an extra dependency, fixes the Node.js module version, and turns off features that Electron does not ship, such as the CET shadow stack and CFI.

Sources: [build/args/all.gn:1-8](repo://build/args/all.gn#L1-L8)

Sources: [build/args/all.gn:40-48](repo://build/args/all.gn#L40-L48)

The testing configuration builds with debug off, dchecks on, and the component build off. The release configuration builds an official build with the same shared base.

Sources: [build/args/testing.gn:1-7](repo://build/args/testing.gn#L1-L7)

Sources: [build/args/release.gn:1-4](repo://build/args/release.gn#L1-L4)

The build guide creates an output folder for each configuration with `gn gen`, passing the file as the `--args` value.

Sources: [docs/development/build-instructions-gn.md:124-128](repo://docs/development/build-instructions-gn.md#L124-L128)

Sources: [docs/development/build-instructions-gn.md:143-146](repo://docs/development/build-instructions-gn.md#L143-L146)

## Targets

`BUILD.gn` imports `filenames.gni`, which lists the C++ sources, and `build/webpack/webpack.gni`, which holds the template for the JavaScript bundles. The main native code is one `source_set` named `electron_lib`, which carries the branding and library configs.

Sources: [BUILD.gn:22-29](repo://BUILD.gn#L22-L29)

Sources: [BUILD.gn:423-431](repo://BUILD.gn#L423-L431)

`electron_fuses` is an action that runs `build/fuses/build.py` on `build/fuses/fuses.json5`. It writes `fuses.h` and `fuses.cc` into the generated folder, so the binary carries the fuse values.

Sources: [BUILD.gn:393-404](repo://BUILD.gn#L393-L404)

The `electron` group is the public entry point. It depends on `electron_app`, so building `electron` builds the application. The Node.js headers that native add-ons need are produced by a separate group, `node_headers`.

Sources: [BUILD.gn:1557-1559](repo://BUILD.gn#L1557-L1559)

Sources: [BUILD.gn:1618-1620](repo://BUILD.gn#L1618-L1620)

## Checks

The `gn-check` npm script runs `script/gn-check.js`, which checks the GN graph. The `lint:gn` script runs the lint script's GN linter. Both are described in [[Testing and Linting]].

Sources: [package.json:71-83](repo://package.json#L71-L83)

Sources: [script/gn-check.js:1-4](repo://script/gn-check.js#L1-L4)
