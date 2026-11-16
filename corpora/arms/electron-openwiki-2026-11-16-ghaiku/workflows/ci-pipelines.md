---
type: workflow
title: CI Pipelines and Release Automation
description: The GitHub Actions workflows and composite actions that build, test, lint, and publish Electron, and the script/release tooling that prepares releases, triggers CI builds, validates and publishes release assets, and generates notes. Also notes the scheduled OpenWiki update workflow.
tags: [ci, github-actions, pipelines, release, publish, script-release, composite-actions]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T11:29:50.477Z
sources:
  - id: openwiki-source-757d9d2fe211560800b04a7b
    resource: repo://.github/actions/build-electron/action.yml
  - id: openwiki-source-6f6acd7aaa4692944c47e9f8
    resource: repo://.github/actions/checkout/action.yml
  - id: openwiki-source-7a80b79a6fb3618cbfab08a2
    resource: repo://.github/workflows/build.yml
  - id: openwiki-source-6d4b4e707b8d60b6ccfa3425
    resource: repo://.github/workflows/openwiki-update.yml
  - id: openwiki-source-6f8717aba7b1b1a65091a6bb
    resource: repo://.github/workflows/pipeline-electron-build-and-test.yml
  - id: openwiki-source-7f8aca0d076f3404d7321ec9
    resource: repo://.github/workflows/pipeline-segment-electron-build.yml
  - id: openwiki-source-a451af1020481deef77be531
    resource: repo://script/release/release.ts
  - id: openwiki-source-98d8e1e5211f816fb0bb8f19
    resource: repo://script/release/run-release-ci-jobs.ts
generated: { by: "claude-code", at: "2026-11-16T11:29:50.477Z" }
---

# CI Pipelines and Release Automation

Electron's continuous integration runs in GitHub Actions. The workflows are layered: top-level workflows (`build.yml`, the `*-publish.yml` files) call reusable pipelines (`pipeline-*.yml`), which in turn call segments (`pipeline-segment-*.yml`) and composite actions under `.github/actions/`. Release work is driven by the TypeScript tooling in `script/release/`, which talks to GitHub and to the artifact storage. This page maps those pieces. For the build itself, see [Building Electron with GN and Ninja](build-and-gn.md).

## Top-level build workflow

`.github/workflows/build.yml` (named `Build`) runs on `workflow_dispatch`, on pushes to `main` and to branches named `NN-x-y` (`[1-9][0-9]-x-y`), and on every pull request. Its `workflow_dispatch` inputs include `build-image-sha` (the container image used for the build), and `skip-macos`, `skip-linux`, `skip-windows`, `skip-lint`, and `enable-ssh`, which let a maintainer run a subset of the matrix.

The workflow's jobs are:

1. **setup** determines which paths changed, using a path filter with `docs` and `src` groups. Docs-only changes are routed to a lighter pipeline.
2. **lint** calls `pipeline-electron-lint.yml`.
3. **docs-only** calls `pipeline-electron-docs-only.yml` when only documentation changed.
4. **checkout** jobs, one per platform, run `.github/actions/checkout` to fetch Chromium and Electron and to validate the patch set (see [Chromium Upgrade and Patch Maintenance Workflow](chromium-upgrade-and-patch-workflow.md)).
5. **gn-check** calls `pipeline-segment-electron-gn-check.yml` for each platform.
6. **build-and-test** jobs call `pipeline-electron-build-and-test.yml` (or the `-and-nan` variant, which also runs the native-module tests) for each platform and architecture.

Each platform job gets its own build runner and test runner, passed as the `build-runs-on` and `test-runs-on` inputs of the pipeline.

## Pipelines and segments

- `pipeline-electron-build-and-test.yml` takes inputs for platform, architecture, runners, container images, `is-release`, `gn-build-type`, and `enable-ssh`. It calls the `build` segment and then the `test` segment, which declares `needs: build`.
- `pipeline-segment-electron-build.yml` runs the compile. It restores the source cache using a key built from `.depshash` (see the upgrade workflow page), then runs the `build-electron` composite action. It is the only workflow that calls `build-electron`.
- `pipeline-segment-electron-test.yml` runs the spec suite on the test runner (see [Test Suite (spec/) and Test Runners](testing-spec-suite.md)).
- `pipeline-segment-electron-gn-check.yml` runs GN checks.
- `pipeline-segment-node-nan-test.yml` runs the Node.js and native-module (nan) test suites.
- `pipeline-electron-lint.yml` downloads the GN, clang-format, and clang-tidy binaries matched to the `chromium_version` in `DEPS`, then runs the lint script (see [Linting and Formatting](linting.md)).
- `pipeline-electron-docs-only.yml` runs the docs checks for documentation-only changes.

## Composite actions

`.github/actions/` contains the reusable steps:

- `checkout` restores the git cache, runs `gclient sync` with three-way patch merging, re-exports patches for non-release builds, and fails when the patch set has drifted.
- `install-dependencies` installs the build dependencies for the runner.
- `build-electron` runs the GN build, checks the `dist.zip` and `chromedriver.zip` contents against their manifests (`script/zip_manifests/check-zip-manifest.py`), and zips the symbols with `script/zip-symbols.py` (see [Code Signing, Packaging, and Distribution Artifacts](../concepts/code-signing-and-packaging.md)).
- `build-git-cache` and `restore-cache-*` actions manage the git cache and the build caches, including Azure blob storage caches.
- `generate-types`, `set-chromium-cookie`, `fix-sync`, `free-space-macos`, `install-build-tools`, `cipd-install`, and `ssh-debug` are smaller helpers. `ssh-debug` opens an SSH session on macOS build jobs when `enable-ssh` is set or step debugging is on.

The checkout action adds `patch-conflict` and `merge-conflict` problem matchers before syncing, and removes them afterward.

## Publish workflows

- `linux-publish.yml`, `macos-publish.yml`, and `windows-publish.yml` are manual (`workflow_dispatch`) workflows. Each takes a build-image SHA, an option to upload to Azure storage, and an option to run only the build jobs instead of the publish jobs. Each runs on the platform's build runner and checks out and syncs Electron in the same way as the build workflow.

## Release tooling in script/release

The release tooling is TypeScript run with `ts-node`:

- `prepare-release.ts` chooses the next version (`getNewVersion`), gathers release notes (`getReleaseNotes`), creates the release (`createRelease`), pushes the release branch, triggers the release builds (`runReleaseBuilds`), and tags the release (`tagRelease`). `prepareRelease` and `printNextVersion` are its exported entry points.
- `release.ts` validates and publishes. `makeRelease` takes the draft release, uploads the Node.js shasums, creates the release SHASUMS files (`createReleaseShasums`), validates the assets (`validateReleaseAssets`), uploads `index.json`, and publishes the draft (`publishRelease`). It then asks the operator to run `npm run publish-to-npm`. `validateRelease` checks a release after publication by verifying remote files against the shasum mapping (`verifyShasumsForRemoteFiles`).
- `run-release-ci-jobs.ts` triggers the CI builds for a release by calling `createWorkflowDispatch` on the named workflow files.
- `version-bumper.ts`, `version-utils.ts`, `types.ts`, `get-asset.ts`, `get-url-hash.ts`, `find-github-release.ts`, and `github-token.ts` support the rest of the flow.
- `notes/` generates the release notes from pull request metadata.
- `uploaders/` contains the upload scripts, including `upload-to-github.ts`, `upload.py`, `upload-symbols.py`, `upload-node-checksums.py`, `upload-node-headers.py`, and `upload-index-json.py`.

Consequence: a release is assembled in stages. Builds run in CI, a draft release collects their assets, the shasums are verified against the uploaded files, and only then is the release published.

## Scheduled OpenWiki update

`.github/workflows/openwiki-update.yml` (named `OpenWiki Update`) runs on `workflow_dispatch` and once a day at 08:00 UTC. It installs the `openwiki` CLI, runs `openwiki code --update --print`, deletes `openwiki/.run.json`, and opens a pull request on the branch `openwiki/update` that adds the `openwiki/` directory, `AGENTS.md`, and the workflow file. The step that runs OpenWiki is set to `continue-on-error`, so the pull request is still created when generation fails, and the pull request text records the outcome. At the time of this run, the file was present in the working tree but not yet tracked by git.

## Failure behavior

- A failed lint, build, or test job stops the dependent jobs in the pipeline. Documentation-only changes skip the full build.
- A patch-set drift in a non-release checkout fails the checkout step (see [Chromium Upgrade and Patch Maintenance Workflow](chromium-upgrade-and-patch-workflow.md)).
- A zip that differs from its manifest fails `build-electron`.
- A release whose shasums do not match the uploaded assets fails `verifyShasumsForRemoteFiles`.

## Related pages

- [Building Electron with GN and Ninja](build-and-gn.md)
- [Testing](testing-spec-suite.md)
- [Linting and Formatting](linting.md)
- [Chromium Upgrade and Patch Maintenance Workflow](chromium-upgrade-and-patch-workflow.md)
- [Code Signing, Packaging, and Distribution Artifacts](../concepts/code-signing-and-packaging.md)
