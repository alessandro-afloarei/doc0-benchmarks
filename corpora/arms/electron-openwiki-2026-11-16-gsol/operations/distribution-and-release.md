---
type: operations
title: Distribution, npm installation, and releases
description: How GN artifacts become npm-installed Electron binaries, how executable resolution and fuses behave, and how release stages are coordinated.
tags: [distribution, npm, release, fuses, updates]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T07:11:18.304Z
sources:
  - id: openwiki-source-ec2e5719a4f01093665ba043
    resource: repo://BUILD.gn
  - id: openwiki-source-948a7a9d83defa7e291d47d4
    resource: repo://build/fuses/fuses.json5
  - id: openwiki-source-cad86df96855bf24ce88eaed
    resource: repo://lib/browser/api/auto-updater.ts
  - id: openwiki-source-839eb8f5d8645abf5981e523
    resource: repo://lib/browser/api/auto-updater/auto-updater-win.ts
  - id: openwiki-source-0664adc5042eb460fb4a27ca
    resource: repo://npm/cli.js
  - id: openwiki-source-302384b64451af669c609e61
    resource: repo://npm/index.js
  - id: openwiki-source-e7b1983e42c3f99277ea13f3
    resource: repo://npm/install.js
  - id: openwiki-source-fba9e7e3e57c0a479bdd26b5
    resource: repo://npm/package.json
  - id: openwiki-source-73c3c0deaddf7ec2d5efb6c1
    resource: repo://script/release/bin/publish-to-npm.ts
  - id: openwiki-source-a451af1020481deef77be531
    resource: repo://script/release/release.ts
generated: { by: "codex", at: "2026-11-16T07:11:18.304Z" }
---

# Distribution, npm installation, and releases

Electron's native distribution archive, npm installer package, and an application's own update system are separate stages. Their source owners meet through versioned artifacts, checksums, and executable paths.

## Build artifacts

The GN `electron_dist_zip` target depends on the application, version file, and licenses and produces `dist.zip`. Linux adds the sandbox binary and, for official builds, stripped artifacts. Separate targets package FFmpeg and ChromeDriver. Build this target from the Chromium `src` directory:

```sh
ninja -C out/Release electron:electron_dist_zip
```

The [build workflow](build-and-upstream-dependencies.md) explains configuration and checkout prerequisites. For packaging a consumer application with these binaries, use [application distribution](../../docs/tutorial/application-distribution.md).

## npm installation and resolution

The npm template runs `node install.js` in postinstall. That script:

1. Exits early for `ELECTRON_SKIP_BINARY_DOWNLOAD` or an installation whose version, path metadata, and executable check pass.
2. Selects platform and architecture, honoring `npm_config_platform` and `npm_config_arch`. On macOS it detects Rosetta when architecture was not explicitly configured.
3. Calls `@electron/get` with the package version, Electron artifact name, cache options, and checksum configuration.
4. Extracts into the package's `dist` directory and writes `path.txt` with the platform-relative executable name. Download or extraction failure exits with code 1.

Plain Node `require('electron')` loads `npm/index.js` and returns the executable path. Inside Electron, the runtime supplies Electron's APIs instead. The npm entry reads `path.txt`, joins it under `dist`, or uses `ELECTRON_OVERRIDE_DIST_PATH`. Without metadata or an override, it throws an installation error.

The CLI spawns that resolved executable with the supplied arguments and inherited stdio. It forwards SIGINT/SIGTERM and propagates the exit code, treating signal-only termination as failure.

An override affects executable lookup and some installer checks; extraction itself still targets the npm package's `dist` directory. Do not treat the override as an alternate extraction destination. Skipping download also does not create an executable.

## Binary fuses

`build/fuses/fuses.json5` defines versioned runtime fuse defaults. This checkout enables run-as-Node, Node options, CLI inspection, and extra file-protocol privileges; it disables embedded ASAR integrity validation, ASAR-only application loading, and the browser-specific snapshot option by default.

These switches configure binary behavior independently of application JavaScript. ASAR-only loading changes application lookup, and run-as-Node affects child-process strategies. See [ASAR and module loading](../concepts/asar-and-module-loading.md) and [the fuse guide](../../docs/tutorial/fuses.md) before changing distribution behavior.

## Maintainer release lifecycle

The release-script README describes entrypoints coordinated by Sudowoodo. The process prepares a version/tag and platform builds, validates required artifacts and hashes, publishes the GitHub release and supporting metadata, then publishes the npm package.

The current GitHub release implementation creates checksum assets, fetches the draft again, validates assets, uploads the public index, and finally marks the release published. Index publication deliberately precedes final GitHub publication to satisfy downstream consumers, while occurring late enough to reduce inconsistent metadata.

The npm publisher stages the npm template files in a temporary directory, sets release metadata, downloads `electron.d.ts` and release checksums, and emits `checksums.json`. Missing release assets fail publication preparation. This joins runtime installation verification to the artifacts produced by release builds. These are maintainer automation stages, not commands needed for normal local development.

## Application auto-updates

The auto-updater module chooses the Windows Squirrel implementation on win32 and a native binding otherwise. The Windows implementation requires a feed URL and Squirrel support, emits update progress events, downloads the update, and exposes quit-and-install behavior. Calling quitAndInstall without an available update emits an error.

This application lifecycle is independent of npm's postinstall download. Consult [autoUpdater](../../docs/api/auto-updater.md) for platform support and application requirements; use [runtime testing](../testing/runtime-and-api-tests.md) to investigate updater fixtures without publishing a release.
