---
type: operations
title: Releases and npm distribution
description: How Electron binaries reach users — the electron npm package (postinstall download via @electron/get with pinned checksums, path.txt, the cli wrapper, environment overrides) and the release scripts that bump versions, create draft GitHub releases, run release builds, upload artifacts, generate notes and publish to npm.
tags: [operations, release, npm, distribution, ci]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T08:25:33.723Z
sources:
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
  - id: openwiki-source-f9485028fff0ad1258242c71
    resource: repo://script/release/bin/README.md
  - id: openwiki-source-11240b883db4626797b83aa4
    resource: repo://script/release/notes/notes.ts
  - id: openwiki-source-a07a34349bb59da7510b7973
    resource: repo://script/release/prepare-release.ts
  - id: openwiki-source-a2a4a8b147c5c3fa01b8d3a8
    resource: repo://script/release/version-bumper.ts
generated: { by: "claude-code", at: "2026-11-16T08:25:33.723Z" }
---

# Releases and npm distribution

## The `electron` npm package (`npm/`)

The npm package does **not** contain Electron itself. It is a small wrapper
whose `postinstall` (`npm/install.js`) downloads the platform zip that the
release process uploaded to GitHub Releases.

### install.js

1. Exit immediately if `ELECTRON_SKIP_BINARY_DOWNLOAD` is set.
2. Exit if already installed: `dist/version` must equal the package version,
   `path.txt` must match the platform executable path, and the executable must
   exist (under `ELECTRON_OVERRIDE_DIST_PATH` if set).
3. Determine `platform`/`arch` from `npm_config_platform` / `npm_config_arch`
   or the host. On macOS, an x64 Node running under Rosetta
   (`sysctl.proc_translated == 1`) downloads **arm64** unless the arch was
   explicitly requested.
4. `downloadArtifact` from `@electron/get` (cached; `force_no_cache`,
   `electron_config_cache` honoured), verified against the **bundled
   `checksums.json`** unless `electron_use_remote_checksums` is set.
5. Extract into `dist/`, move a bundled `electron.d.ts` up to the package
   root, and write `path.txt` with the platform-relative executable path
   (`Electron.app/Contents/MacOS/Electron`, `electron`, or `electron.exe`).
   Unsupported platforms throw.

### index.js and cli.js

- `require('electron')` **from Node** (not inside Electron) returns the
  absolute path of the executable, read from `path.txt` (or joined with
  `ELECTRON_OVERRIDE_DIST_PATH`). If `path.txt` is missing it throws asking
  the user to reinstall. Tools such as test runners spawn this path.
- `cli.js` (the `electron` bin) spawns that executable with the given
  arguments and inherited stdio, forwards `SIGINT`/`SIGTERM`, and exits with
  the child's exit code (1 if it died from a signal).
- `package.json` declares `"types": "electron.d.ts"`, so the generated
  public typings ship with the package.

## Release process (`script/release/`)

The scripts in `script/release/bin/` are not meant to be run by hand; the
release automation bot calls them at each stage (see
`script/release/bin/README.md`). The stages are:

| Stage | Script | What it does |
| --- | --- | --- |
| Next version | `print-next-version` | dry-run version computation |
| Prepare | `prepare-for-release` → `prepareRelease()` | compute the new version, create a **draft** GitHub release (aborting if one already exists for that tag), push the tagged commit, and trigger release CI builds via `run-release-ci-jobs.ts` |
| Rebuild | `run-release-builds` | re-kick specific failed release builds |
| Validate | `validate-before-publish` | all assets exist, checksums match, headers and symbols uploaded to CDNs |
| Publish GitHub | `publish-to-github` | upload header SHASUMs, update `index.json` on the assets CDN, publish the release |
| Publish npm | `publish-to-npm` | build and publish the npm tarball |
| Cleanup | `cleanup-release` | delete the draft release and tag of a failed version (the only case where tags are deleted) |

### Versioning

`script/release/version-bumper.ts` computes the next version for bump types
`nightly`, `alpha`, `beta` and `stable`. From a prerelease, `stable` strips
the prerelease suffix; from a stable version, bumping to `alpha` or `beta` is
rejected. Nightly releases target `main` and include a notice pointing to the
`electron-nightly` package; other prereleases are marked `prerelease` on
GitHub.

### Release notes

`script/release/notes/notes.ts` walks commits between two refs, resolves
their PRs (including backport "trop" PRs), and extracts each PR's release
note; PRs marked with no notes are dropped. Commits are grouped by semantic
type into **Breaking Changes**, **Features**, **Fixes**, and other sections
before rendering Markdown. Write meaningful `Notes:` in PR descriptions —
they become the published changelog.

### Uploading artifacts

CI release builds run `script/release/uploaders/upload.py`, which renames
`dist.zip` to the versioned `electron-vX-platform-arch.zip` and uploads it
along with symbols, dSYM/PDB/debug zips, `electron-api.json`,
`electron.d.ts`, chromedriver/mksnapshot zips and checksums
(`upload-to-github.ts`, `upload-node-headers.py`, `upload-symbols.py`, …).

### Publishing to npm

`publish-to-npm.ts` assembles a temporary package from `npm/`, downloads
`electron.d.ts` and `SHASUMS256.txt` from the GitHub release, converts the
checksums into the bundled `checksums.json` that `install.js` verifies against,
records the Node ABI (`node_module_version` from the GN args) in
`abi_version`, and publishes with an npm dist-tag:

- nightlies are published as `electron-nightly` (tag `latest` from `main`,
  `nightly-<branch>` otherwise);
- stable/beta/alpha releases get branch tags such as `2-0-x`,
  `beta-3-0-x`, `alpha-3-0-x`, and `latest`/`beta`/`alpha` are moved when the
  version is newer than the current tag.

## Related

- Build targets that produce these artifacts:
  [GN build, DEPS and build configuration](../build/gn-build-and-deps.md).
- Public typings come from `docs/api`; see
  [Workflow: adding or changing an API](../workflows/adding-an-api.md).
