---
title: "Release and Publishing"
---
## Overview

A release starts as a git tag and a draft GitHub release, and it ends with the release published on GitHub and the `electron` package published on npm. The release scripts in `script/release/` drive both halves, and the npm package in `npm/` is what users install. This page follows the steps in order. The native build that produces the artifacts is on [[Build System]], and the install-time download of the binary is covered on [[Quickstart]].

Sources: [script/release/prepare-release.ts:213-222](repo://script/release/prepare-release.ts#L213-L222)

## Preparing a release

`prepareRelease` runs four steps in order: it works out the next version, creates the release, pushes it, and starts the release builds. The branch to release is the target branch if one is given, and the current branch otherwise.

Sources: [script/release/prepare-release.ts:213-222](repo://script/release/prepare-release.ts#L213-L222)

`tagRelease` creates an annotated tag named after the version, and `pushRelease` pushes the current branch with `--follow-tags`, so the tag reaches the remote in the same push.

Sources: [script/release/prepare-release.ts:192-206](repo://script/release/prepare-release.ts#L192-L206), [script/release/prepare-release.ts:168-172](repo://script/release/prepare-release.ts#L168-L172)

`runReleaseBuilds` hands the branch and version to `runReleaseCIJobs` with the `ghRelease` flag set. The flag sets the `upload-to-storage` workflow input to `0` for the GitHub Actions build request, and without the flag the input is `1`.

Sources: [script/release/prepare-release.ts:184-190](repo://script/release/prepare-release.ts#L184-L190), [script/release/run-release-ci-jobs.ts:29-40](repo://script/release/run-release-ci-jobs.ts#L29-L40)

## Target repository

The release goes to the nightly repository when the version contains `nightly`, and to the main Electron repository otherwise. The npm publisher applies the same rule to choose its repository.

Sources: [script/release/release.ts:25-31](repo://script/release/release.ts#L25-L31), [script/release/bin/publish-to-npm.ts:47-56](repo://script/release/bin/publish-to-npm.ts#L47-L56)

## Making the release public

`makeRelease` fetches the single draft for the version. It uploads the Node.js shasums, creates the checksum files for the release, and then fetches the draft again before it validates the assets. This second fetch makes sure that the checks see the assets that the upload just added.

Sources: [script/release/release.ts:414-421](repo://script/release/release.ts#L414-L421)

The `index.json` upload comes after validation and before the final publish, and the code's comment gives the reason. The index goes live as soon as it is uploaded, so it is written as late as possible, and it must list every release before that release is published.

Sources: [script/release/release.ts:422-428](repo://script/release/release.ts#L422-L428)

`publishRelease` marks the release as the latest only when it is not a prerelease and its tag is at least as new as the current latest release, using a semver comparison. The update then sets `draft` to false, which publishes the release.

Sources: [script/release/release.ts:382-406](repo://script/release/release.ts#L382-L406)

Checksum filenames are fixed: `SHASUMS256.txt` and the older `SHASUMS.txt`. The verification step reads each file's hash from the release and checks it against the published checksums.

Sources: [script/release/release.ts:435-437](repo://script/release/release.ts#L435-L437)

## Publishing to npm

`publish-to-npm.ts` exits unless `ELECTRON_NPM_OTP` is set, and it passes that value to `npm publish` as the one-time password. It copies the files that make up the package from `npm/` into a temporary folder, namely `cli.js`, `index.js`, `install.js`, `package.json`, `README.md` and `LICENSE`, and copies the listed metadata fields from the root `package.json`.

Sources: [script/release/bin/publish-to-npm.ts:17-20](repo://script/release/bin/publish-to-npm.ts#L17-L20), [script/release/bin/publish-to-npm.ts:25-41](repo://script/release/bin/publish-to-npm.ts#L25-L41), [script/release/bin/publish-to-npm.ts:67-80](repo://script/release/bin/publish-to-npm.ts#L67-L80)

The publisher fetches two assets from the GitHub release. The `electron.d.ts` file becomes the package's typings, and `SHASUMS256.txt` is parsed into a `checksums.json` file that `npm/install.js` checks downloads against. The ABI version is read from the `node_module_version` line of `build/args/all.gn`.

Sources: [script/release/bin/publish-to-npm.ts:103-117](repo://script/release/bin/publish-to-npm.ts#L103-L117), [script/release/bin/publish-to-npm.ts:118-138](repo://script/release/bin/publish-to-npm.ts#L118-L138), [script/release/bin/publish-to-npm.ts:139-150](repo://script/release/bin/publish-to-npm.ts#L139-L150)

The npm dist-tag depends on the branch and the release kind. A nightly on `main` gets `latest`, and a nightly on another branch gets `nightly-<branch>`. An alpha or beta gets `alpha-<branch>` or `beta-<branch>`, and a stable release on a version branch gets the branch name as its tag.

Sources: [script/release/bin/publish-to-npm.ts:155-182](repo://script/release/bin/publish-to-npm.ts#L155-L182)

The publisher packs the folder with `npm pack`, then installs the tarball with `npm install --force --silent`. It publishes with `npm publish --tag` only when `npm view` finds no entry for the version, so re-running the publish step does not publish the same version twice. The installed package's `install.js` is the one that fetches the binary for each user.

Sources: [script/release/bin/publish-to-npm.ts:185-197](repo://script/release/bin/publish-to-npm.ts#L185-L197), [script/release/bin/publish-to-npm.ts:213-219](repo://script/release/bin/publish-to-npm.ts#L213-L219), [npm/install.js:9-11](repo://npm/install.js#L9-L11)
