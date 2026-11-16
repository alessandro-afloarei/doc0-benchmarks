---
type: operations
title: CI, Release, and Distribution
description: How Electron's GitHub Actions pipelines are triggered and layered (setup, lint, checkout, GN check, build and test segments, docs-only shortcut, publish workflows), what the build segment produces and validates, and how the release scripts draft, verify, and publish a release.
tags: [electron, ci, github-actions, release, distribution, pipelines, zip-manifest, symbols, publish]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T18:50:06.090Z
sources:
  - id: openwiki-source-757d9d2fe211560800b04a7b
    resource: repo://.github/actions/build-electron/action.yml
  - id: openwiki-source-7a80b79a6fb3618cbfab08a2
    resource: repo://.github/workflows/build.yml
  - id: openwiki-source-88593fc06b0ae7eb589b3415
    resource: repo://.github/workflows/linux-publish.yml
  - id: openwiki-source-6f8717aba7b1b1a65091a6bb
    resource: repo://.github/workflows/pipeline-electron-build-and-test.yml
  - id: openwiki-source-fb66f69271e869c3618fec84
    resource: repo://.github/workflows/pipeline-electron-lint.yml
  - id: openwiki-source-437d543fde8af4fce127b205
    resource: repo://.github/workflows/pipeline-segment-electron-test.yml
  - id: openwiki-source-99f09efd6390c11b820fdfd5
    resource: repo://.github/workflows/stable-prep-items.yml
  - id: openwiki-source-f9485028fff0ad1258242c71
    resource: repo://script/release/bin/README.md
  - id: openwiki-source-a451af1020481deef77be531
    resource: repo://script/release/release.ts
  - id: openwiki-source-98d8e1e5211f816fb0bb8f19
    resource: repo://script/release/run-release-ci-jobs.ts
  - id: openwiki-source-2cca80332ef845ce0e1b5146
    resource: repo://script/zip_manifests/check-zip-manifest.py
generated: { by: "claude-code", at: "2026-11-16T18:50:06.090Z" }
---

# CI, Release, and Distribution

<!-- openwiki: broken internal link [/openwiki/workflows/building.md] link "/openwiki/workflows/building.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [/openwiki/workflows/testing.md] link "/openwiki/workflows/testing.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
Electron's continuous integration runs on GitHub Actions and is organized as a set of reusable pipelines. A top-level `build.yml` decides what needs to run for a change, calls per-platform pipelines, and each of those calls build and test segments. Releases use a separate set of publish workflows and a release script that validates assets before publishing. This page describes the pipeline layers and the release path. The build steps that the pipelines run are covered in [Building Electron](/openwiki/workflows/building.md), and the test suites in [Testing](/openwiki/workflows/testing.md).

## Triggers

`.github/workflows/build.yml` is the main entry point. It runs on:

- `workflow_dispatch`, with inputs that choose the build image SHA and skip individual platform groups (macOS, Linux, Windows) or the lint job, and that can enable SSH debugging.
- `push` to `main` and to branches matching `[1-9][0-9]-x-y`, which are the stable-line branches.
- `pull_request`. Checkout steps in the pipelines use `github.event.pull_request.head.sha` as the ref.

The reusable pipelines set a concurrency group keyed by the ref, or by the run ID for protected refs.

## Pipeline layers

`build.yml` is organized in this order:

1. **`setup`** computes outputs. A path filter sets a `docs` output when `docs/**` changed and a `src` output for everything else (minus `docs/**`). `docs-only` is true only when docs changed and nothing else did. The setup job also resolves the build image SHA used by every container.
<!-- openwiki: broken internal link [/openwiki/workflows/contributing-and-linting.md] link "/openwiki/workflows/contributing-and-linting.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
2. **`lint`** calls `pipeline-electron-lint.yml` unless `skip-lint` is set. It installs dependencies, downloads GN and clang-format, runs `node script/yarn lint`, and then runs the script typechecker. Problem matchers for ESLint are registered first so failures annotate the diff. The commands and their gates are covered in [Contributing and Linting](/openwiki/workflows/contributing-and-linting.md).
3. **`docs-only`** calls `pipeline-electron-docs-only.yml` when `docs-only` is true. That pipeline restores the source cache, installs dependencies, and runs the TypeScript and JavaScript compile step, without building the browser.
<!-- openwiki: broken internal link [/openwiki/architecture/chromium-and-upstream-patches.md] link "/openwiki/architecture/chromium-and-upstream-patches.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
4. **`checkout-macos`, `checkout-linux`, and `checkout-windows`** each run the checkout composite action (`.github/actions/checkout`). It restores the git cache, runs `gclient sync` with three-way patch merging, and on non-release builds re-exports the patches and pushes any change to the pull request, as described in [Chromium, Node, and Upstream Patches](/openwiki/architecture/chromium-and-upstream-patches.md). The checkout jobs save the synced tree as a cache so the build jobs do not repeat it.
5. **GN check** runs `pipeline-segment-electron-gn-check.yml` once per platform group, after the matching checkout job.
6. **Build and test** runs one `pipeline-electron-build-and-test.yml` call per target. The calls cover macOS x64 and arm64, Linux x64 (with an ASan variant), Linux arm and arm64, and Windows x64, x86, and arm64. Some Linux targets use `pipeline-electron-build-and-test-and-nan.yml` instead, which adds native-module (NAN) tests.
7. **`gha-done`** is the final gate. It runs when `always()` and fails if any upstream job failed, so a single check can gate merges.

Within one target, `pipeline-electron-build-and-test.yml` runs a `build` job, then a `test` job that needs it. The build job calls `pipeline-segment-electron-build.yml` and the test job calls `pipeline-segment-electron-test.yml`.

## What the build segment produces

`pipeline-segment-electron-build.yml` checks out Electron, installs build tools, restores caches (AZCopy or AKS, keyed by a DEPS hash), runs the Electron-only hooks, and then calls the `build-electron` composite action. That action builds in order:

- `dist.zip`, the packaged Electron distribution. Its contents are checked against `script/zip_manifests/dist_zip.<os>.<arch>.manifest` by `script/zip_manifests/check-zip-manifest.py`.
- Mksnapshot, plus a cross-architecture snapshot for arm and arm64 targets.
- Chromedriver, checked against `chromedriver_zip.<os>.<arch>.manifest` in the same way.
- Node.js headers and an `installed_software.json` record of the toolchain.
- Symbols, generated and zipped in the `Generate & Zip Symbols` step. The macOS and Linux publish workflows set `generate-symbols: true`.
- FFmpeg, Hunspell dictionaries, and other generated resources.

A manifest mismatch fails the build, which is how the set of files in each zip is kept stable across releases.

For a Mac App Store target, the build runs a second `build-electron` pass with MAS-specific `GN_EXTRA_ARGS`.

## What the test segment does

<!-- openwiki: broken internal link [/openwiki/architecture/security-model-and-fuses.md] link "/openwiki/architecture/security-model-and-fuses.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
`pipeline-segment-electron-test.yml` downloads the generated and source artifacts from the build job, restores the generated artifacts, and unpacks `dist.zip`, mksnapshot, and chromedriver. It then runs the Electron test suite with `ELECTRON_DISABLE_SECURITY_WARNINGS=1` set, so the renderer security warnings described in [Security Model and Fuses](/openwiki/architecture/security-model-and-fuses.md) do not clutter test logs. Tests are sharded across matrix entries. Results are uploaded to Datadog and as test artifacts, and an optional SSH session can be held open for debugging when `enable-ssh` is set.

The test job on macOS also adjusts system state (TCC permissions and the unexpected-quit dialog) and selects Xcode 16.4 before running tests.

## Release path

Releases are cut in three stages, with separate scripts for each.

**Preparation.** The release scripts in `script/release/bin/` are documented in `script/release/bin/README.md` as being invoked by a release bot named Sudowoodo, not by hand. `prepare-for-release` creates the git tag and starts the release builds. `run-release-build` re-runs a failed build. `cleanup-release` deletes a draft release and its tag, which is the only case where an existing tag is removed. `print-next-version` reports the version a release would take.

**Building.** `script/release/run-release-ci-jobs.ts` triggers the `linux-publish`, `macos-publish`, and `windows-publish` workflows through the GitHub API, passing the release flag. Each publish workflow has `workflow_dispatch` inputs for the build image SHA, whether to upload to Azure storage, and whether to run the publish jobs or only the builds. Its jobs are per architecture (for example `publish-x64`, `publish-arm`, and `publish-arm64` in `linux-publish.yml`) and set `is-release: true`. In `build-electron`, release builds upload the distribution through `script/release/uploaders/upload.py`. With `upload-to-storage` set it uploads to Azure, and otherwise it uploads to the GitHub release. Symbols go through `script/release/uploaders/upload-symbols.py`.

**Validation and publishing.** `script/release/release.ts` runs `validateRelease`. It finds the draft release whose tag matches the current version, checks the assets with `validateReleaseAssets` (which looks at both the GitHub draft and the Azure storage copy), creates and merges the SHASUMS file, and verifies that the hashes match the remote files. Only then does `publishRelease` publish. The `makeLatest` flag is set by comparing the new tag with the current latest release using semver. After publishing, the script tells the operator to run `publish-to-npm`. The script's own comment says the validation step runs before the final publish so that no published release is left without matching assets.

## Signing and identities

`script/codesign/` contains the scripts for generating and trusting a self-signed codesigning identity (`generate-identity.sh`, `get-trusted-identity.sh`, `gen-trust.ts`, plus `codesign.cnf` and `trust.xml`). In the test segment, the step that imports and trusts that certificate on macOS is commented out in `pipeline-segment-electron-test.yml`, so the scripts are present but not active in the current test path. Production signing is handled by the platform publish workflows and release tooling, not by these test-time scripts.

## Scheduled maintenance

`stable-prep-items.yml` runs on a schedule every 12 hours (`0 */12 * * *`) and on `workflow_dispatch`. It updates the status of stable-release preparation items on the release project board, using a GitHub App token. It does not build or publish anything.

## Invariants and failure behavior

- A manifest mismatch in `dist.zip` or `chromedriver.zip` fails the build. Changing what a zip contains requires changing the corresponding manifest in the same change.
- `gha-done` fails if any upstream job failed, so a single required check covers the whole matrix.
- Release publishing verifies the draft's assets and remote hashes before it changes the release state. A failed validation leaves the draft in place.
- `script/release/bin/README.md` describes `cleanup-release` as the only script that deletes an existing tag, and it notes that tags are treated as immutable once a release is published.

## Related pages

<!-- openwiki: broken internal link [/openwiki/workflows/building.md] link "/openwiki/workflows/building.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Building Electron](/openwiki/workflows/building.md) describes the local build that these pipelines run.
<!-- openwiki: broken internal link [/openwiki/workflows/testing.md] link "/openwiki/workflows/testing.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Testing](/openwiki/workflows/testing.md) describes the spec suites the test segment runs.
<!-- openwiki: broken internal link [/openwiki/workflows/contributing-and-linting.md] link "/openwiki/workflows/contributing-and-linting.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Contributing and Linting](/openwiki/workflows/contributing-and-linting.md) covers the lint gate in the lint pipeline.
