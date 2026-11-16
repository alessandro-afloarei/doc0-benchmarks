---
type: operations
title: Distribution, npm installation, and application updates
description: Electron binary packaging and release validation, npm package installation and executable resolution, and platform-specific application auto-update behavior.
tags: [distribution, npm, releases, auto-updater]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T08:40:08.980Z
sources:
  - id: openwiki-source-ec2e5719a4f01093665ba043
    resource: repo://BUILD.gn
  - id: openwiki-source-91783a68ee2d2a605d80331f
    resource: repo://docs/api/auto-updater.md
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
  - id: openwiki-source-a07a34349bb59da7510b7973
    resource: repo://script/release/prepare-release.ts
  - id: openwiki-source-a451af1020481deef77be531
    resource: repo://script/release/release.ts
  - id: openwiki-source-ee9bf99949c891dc4245d849
    resource: repo://shell/browser/auto_updater_mac.mm
  - id: openwiki-source-36006b448f93a7aa52368979
    resource: repo://shell/browser/auto_updater.cc
generated: { by: "codex", at: "2026-11-16T08:40:08.980Z" }
---

# Distribution, npm installation, and application updates

Three separate paths meet here: building a distributable Electron runtime, installing that runtime through npm, and updating an application built on Electron. Diagnose each at its own artifact and state boundary.

## From build output to release assets

The GN electron_dist_zip target depends on the application, version file, and licenses, adding Linux sandbox and official-build stripping dependencies as appropriate. Its output is dist.zip in the build directory. Build it from a configured Chromium source root with:

```sh
ninja -C out/Release electron:electron_dist_zip
```

See [building Electron](../workflows/build-electron.md) for checkout layout and prerequisites.

Release preparation computes and applies a version bump, generates notes, tags the release, rejects an existing matching draft, creates a GitHub draft, pushes the branch/tags, and starts release builds. The prepareRelease orchestration first computes the proposed version in dry-run mode, then performs the real operations.

The publishing phase in release.ts uploads Node checksums, creates combined release checksums, refetches the draft, validates assets, uploads index.json, and finally makes the GitHub release public. index.json is deliberately uploaded late but before publication so downstream version discovery includes the release. Required asset validation and checksum paths are implemented separately; the standalone validateRelease call passes a mode that can skip draft hash verification, whereas makeRelease uses full draft asset verification.

npm publication is another script. It stages the npm package, obtains electron.d.ts and SHASUMS256.txt from the matching release, converts checksums into checksums.json, packs and test-installs the package, then publishes and updates applicable tags. GitHub publication alone does not publish npm. Consult the current script entrypoints rather than copying old npm command names from log messages: the root package scripts are authoritative about available aliases.

## npm installation and launch

The npm package declares install.js as its postinstall. That installer skips all binary work when ELECTRON_SKIP_BINARY_DOWNLOAD is set. Otherwise it checks the installed version, path.txt, and executable existence before deciding whether to download.

Downloads go through @electron/get using the package version, target platform and architecture. npm_config_platform/npm_config_arch override detection. On macOS, an x64 process under Rosetta can select arm64 when no explicit architecture was supplied. The installer passes cache configuration and either bundled checksums or remote-checksum selection, then extracts the archive and writes path.txt. Download or extraction errors cause exit code 1.

In ordinary Node, requiring the installed electron package returns an executable path. index.js uses path.txt and dist, with ELECTRON_OVERRIDE_DIST_PATH as an override; missing installation metadata without an override throws. The CLI spawns that path with application arguments and inherited stdio, forwards SIGINT/SIGTERM, and returns the child exit code or 1 for signal termination.

For installation failures, check version/platform/architecture selection, download failure output, extraction, and path.txt in that order. ELECTRON_SKIP_BINARY_DOWNLOAD intentionally leaves binary provisioning to the caller; it does not install a usable executable itself. See [npm installer](../../npm/install.js) and [path resolution](../../npm/index.js).

## Updating packaged applications

The public autoUpdater selector uses the JavaScript Squirrel.Windows implementation on Windows and the native binding elsewhere. The Windows implementation requires a feed URL and Squirrel support, emits checking-for-update, checks availability, downloads the update, and emits update-downloaded. Errors reach the error event. quitAndInstall requires its updateAvailable state, invokes Squirrel process start, and calls app.quit.

On macOS, the native implementation constructs SQRLUpdater and maps its state and results to Electron events. The API reference requires signed applications for macOS updates. The shared native fallback contains no-op update methods for unsupported configurations, including non-macOS native paths and MAS builds; the API guide explicitly states there is no built-in Linux auto-updater.

Application update feeds and installed application metadata are separate from the npm package's runtime download. [ASAR packaging](../concepts/node-and-asar.md) describes how application resources are read after launch.

## Verification boundaries

Release validation checks assets and hashes; npm staging also tests package installation. Those operations need real artifacts and service access. Runtime update behavior has [macOS auto-updater specs](../../spec/api-autoupdater-darwin-spec.ts). For ordinary source changes, start with the local [validation workflow](../testing/validation.md) and the platform implementation affected by the change.
