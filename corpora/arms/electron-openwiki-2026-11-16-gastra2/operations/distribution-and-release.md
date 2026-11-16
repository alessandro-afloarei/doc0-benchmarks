---
type: operations
title: Distribution, npm installation and releases
description: Electron binary packaging, npm downloader and executable resolution, staged release validation and application auto-updater integration.
tags: [distribution, npm, release, updates]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T18:01:04.581Z
sources:
  - id: openwiki-source-ec2e5719a4f01093665ba043
    resource: repo://BUILD.gn
  - id: openwiki-source-91783a68ee2d2a605d80331f
    resource: repo://docs/api/auto-updater.md
  - id: openwiki-source-cad86df96855bf24ce88eaed
    resource: repo://lib/browser/api/auto-updater.ts
  - id: openwiki-source-839eb8f5d8645abf5981e523
    resource: repo://lib/browser/api/auto-updater/auto-updater-win.ts
  - id: openwiki-source-ea5f1a0f46837a680ad9cc30
    resource: repo://lib/browser/api/auto-updater/squirrel-update-win.ts
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
generated: { by: "codex", at: "2026-11-16T18:01:04.581Z" }
---

# Distribution, npm installation and releases

Electron has three connected distribution concerns: building framework binaries, publishing the npm package that obtains those binaries, and updating applications built with Electron. Their entrypoints and failure modes differ. The root package is private contributor tooling; `npm/` supplies the published install/launch package.

## Binary artifacts

From a configured Chromium `src` directory, `ninja -C out/Release electron:electron_dist_zip` builds a distributable framework archive. The GN target includes the Electron app, version file and licenses, plus platform-specific dependencies such as the Linux sandbox helper and official-build stripping. Its output is `out/Release/dist.zip`. Other targets produce FFmpeg, headers and related development artifacts.

An application's own resources, including `app.asar` and unpacked companions, sit on top of that runtime layout. [ASAR and application loading](../concepts/asar-and-application-loading.md) explains their lookup and integrity behavior; [building Electron](build-and-dependencies.md) explains how to obtain the native runtime.

## npm installation and launching

`npm/package.json` runs `node install.js` on postinstall. The installer checks whether the expected version, executable path record and executable already exist. Otherwise it calls `@electron/get.downloadArtifact`, selecting the package version, target platform/architecture, cache settings and checksum source, then extracts the archive into the package's `dist` directory and writes `path.txt`.

| Setting | Implemented effect |
| --- | --- |
| `ELECTRON_SKIP_BINARY_DOWNLOAD` | Exits before installation work |
| `npm_config_platform`, `npm_config_arch` | Override target artifact selection |
| `electron_config_cache` | Supplies the downloader cache root |
| `force_no_cache=true` | Forces artifact download behavior through the downloader |
| Remote-checksum environment options | Select remote checksums instead of bundled `checksums.json` |
| `ELECTRON_OVERRIDE_DIST_PATH` | Changes executable resolution; inspect installer handling separately |

When macOS is running under Rosetta and architecture was not explicitly selected, the installer probes translation state and can choose arm64. Download/extraction failures are printed and exit with code 1.

In an ordinary Node process, requiring this npm package returns an **executable path string**. `npm/index.js` reads `path.txt`, joins it with `dist` or the override directory, and throws if installation metadata is absent and no override applies. `npm/cli.js` spawns that binary with inherited stdio, forwards SIGINT/SIGTERM and propagates its exit result. Inside Electron, `require('electron')` resolves to runtime API exports through [runtime initialization](../architecture/runtime-startup.md), a different resolution path.

An override directory should not be interpreted as an extraction destination: the installer still extracts into its own `dist` directory, although some checks/type-file handling consult the override. For installation failures, inspect target selection, archive download, extraction and `path.txt` separately.

## Release stages and actual validation

The release-script README identifies these scripts as automation entrypoints called by Sudowoodo. They mutate tags, releases, artifact storage and npm state; they are not local build checks.

1. **Preparation/builds:** prepare a release tag and dispatch platform release builds.
2. **Draft validation:** `validate-before-publish.ts` calls `validateRelease`, which loads the draft and calls `validateReleaseAssets(release, true)`.
3. **GitHub publication:** `publish-to-github.ts` calls `makeRelease`, uploading Node checksums, creating release checksums, refetching the draft, validating it, updating the public artifact index, then publishing the GitHub release.
4. **npm publication:** assemble the npm package with release metadata, type definitions and checksum data, pack and install it in a temporary directory, verify that requiring it resolves to an existing executable, then publish and update applicable tags.

There is an important distinction between stages 2 and 3. Draft validation requires the expected assets but omits `SHASUMS256.txt` from that initial list and skips the hash/CDN verification block while `validatingRelease` is true and the release is still a draft. The publication path creates checksums and runs the fuller validation before publishing. The release README's broad validation summary should not be read as proof that the earlier draft check performed every verification.

`makeRelease` uploads the public `index.json` late, but before GitHub publication, to balance inconsistent downstream states. These external writes are sequential rather than transactional; a partially failed release needs stage-aware recovery. The npm publisher also checks for an already published version before attempting another publish.

## Application auto-updates

The API dispatcher uses a TypeScript Squirrel.Windows implementation on Windows and a native binding elsewhere. The Windows helper expects `Update.exe` next to the versioned application directory. Checking requires a feed URL and supported installation; it emits checking/available/downloaded events around Squirrel operations and emits errors on failure. `quitAndInstall` requires the update-available state, requests restart and quits the app.

macOS uses Squirrel.Mac in `shell/browser/auto_updater_mac.mm`; the API documentation requires a signed application. This checkout documents built-in autoUpdater support for macOS and Windows, with no built-in Linux updater. Framework release publication does not configure an application's update feed or installer.

`spec/api-auto-updater-spec.ts` and fixtures under `spec/fixtures/auto-update/` are the focused runtime regression surface. The package-install check embedded in the npm publisher validates a separate contract: a published package must obtain a runnable-path artifact. See [contributor validation](../testing/contributor-validation.md) for local checks.
