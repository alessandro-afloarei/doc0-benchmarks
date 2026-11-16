---
type: workflow
title: Chromium Upgrade and Patch Maintenance Workflow
description: Operational workflow for moving Electron to a new Chromium, Node.js, or V8 revision. Covers changing the DEPS pins, reapplying the patch stack, exporting and importing patches, the patch-validation lint rules, and how CI detects patch drift, auto-commits repairs, and surfaces conflicts through problem matchers.
tags: [chromium-upgrade, patches, deps, patch-up, ci, lint, gn-version, patch-conflict]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T11:29:50.477Z
sources:
  - id: openwiki-source-6f6acd7aaa4692944c47e9f8
    resource: repo://.github/actions/checkout/action.yml
  - id: openwiki-source-1525a72c6a3c708b756c75ea
    resource: repo://.github/problem-matchers/patch-conflict.json
  - id: openwiki-source-7f8aca0d076f3404d7321ec9
    resource: repo://.github/workflows/pipeline-segment-electron-build.yml
  - id: openwiki-source-29cf14000ac0366c40fd5358
    resource: repo://DEPS
  - id: openwiki-source-298a1003742dda5b1f8a35be
    resource: repo://script/apply_all_patches.py
  - id: openwiki-source-f5f29125daf35c882114a39d
    resource: repo://script/generate-deps-hash.js
  - id: openwiki-source-6c52842c07ac95748b2a27ae
    resource: repo://script/lint.js
  - id: openwiki-source-79f55cc6eb17cd7636a74106
    resource: repo://script/patch-up.js
generated: { by: "claude-code", at: "2026-11-16T11:29:50.477Z" }
---

# Chromium Upgrade and Patch Maintenance Workflow

Upgrading Electron to a new Chromium, Node.js, or V8 revision is mostly a patch-maintenance task. The pins in `DEPS` move forward, the patches in `patches/` are reapplied to the new upstream sources, and any patch that no longer applies or no longer applies cleanly has to be repaired. This page describes the mechanics. The policy for what a patch may contain is described in [Chromium, Node, and V8 Patch Stack](../integrations/chromium-node-v8-patches.md).

## Step 1: change the pins

`DEPS` holds the revisions in its `vars` block. The keys that matter for an upgrade are `chromium_version` (the `src` checkout), `node_version` (the Node.js checkout at `src/third_party/electron_node`), and the other pins such as `nan_version` and the `squirrel.mac` revision. The `deps` entries use these values, so changing the vars is enough to move the checkouts.

Other places that depend on the Chromium revision:

- The lint workflow (`.github/workflows/pipeline-electron-lint.yml`) reads `chromium_version` from `DEPS` and fetches the matching `gn` version from Chromium's `DEPS` file, along with the `buildtools` `DEPS` for clang-format.
- Chromium's own `DEPS` decides which GN and clang-format binaries apply to that revision, so these must track the pin.

## Step 2: sync and let the patches apply

`gclient sync` runs the hooks in `DEPS`. Two hooks matter for patch maintenance:

- `generate_mtime_cache` runs `script/patches-mtime-cache.py generate` and writes `patches/mtime-cache.json`, which is a record of the patch files' hashes.
- `patch_chromium` runs `script/apply_all_patches.py patches/config.json`. That script imports each target's patch set into its upstream repository as commits, using the `ELECTRON_USE_THREE_WAY_MERGE_FOR_PATCHES` environment variable to enable three-way merging. CI sets this variable during the gclient sync step in `.github/actions/checkout/action.yml`.

A failed patch import stops the hook. The output `error: patch failed: <file>:<line>` matches `.github/problem-matchers/patch-conflict.json`, which annotates the failing file and line in the CI log. The `merge-conflict` matcher annotates `CONFLICT` lines in the same way.

## Step 3: repair failing patches

When a patch fails:

1. Find the conflicting upstream code. Use the matcher output or run the apply by hand with `script/git-import-patches <patch_dir>` in the target repository.
2. Resolve the conflict in the upstream checkout and commit the change. Each patch must remain one commit, so make the fix as an amendment to the matching commit or as a new commit that will be exported with the same patch.
3. Export the patches back into `patches/` with `script/git-export-patches -o <patch_dir>`, or with `script/export_all_patches.py patches/config.json` for the whole config. The exporter ignores uncommitted changes.
4. Check the patch's commit message. The reason for the patch must still hold, and an upstreamed or obsolete patch should be removed rather than kept alive.

Re-exporting can change the checksums of unrelated patch files. The contributor documentation calls that harmless and asks contributors to include those changes in their pull request.

## Step 4: CI drift detection and auto-repair

The checkout composite action (`.github/actions/checkout/action.yml`) enforces the patch set on every non-release build:

1. It runs `gclient sync` with the three-way merge variable set.
2. For non-release builds it runs `export_all_patches.py` on the config and checks `git diff-index` in `src/electron` for changes. Any change to `patches/` means the committed patches do not reproduce what was applied.
3. When there are changes, it runs `script/patch-up.js`. That script reads the changed files under `patches/` (including `.patch` files, `README.md`, and `config.json`) and uses a GitHub App credential from `PATCH_UP_APP_CREDS` to push the update to the current branch through the GitHub API. If the push succeeds, the job exits with status 1 and a new CI job starts.
4. If `patch-up.js` fails (for example, the credential is missing or the push is rejected), the action commits the change locally as `chore: update patches` with the PatchUp identity, writes it to `patches/update-patches.patch`, prints the patch, and exits with status 1 so the artifact can be applied by hand.
5. On a clean export, the step logs `No changes to patches detected` and continues.

Consequence: a change that alters how patches apply is never silently accepted. Either the patches are updated and CI reruns, or the job fails with a patch to apply.

The `patch-up.js` credential is only read from the environment variable named in `PATCH_UP_APP_CREDS`. The build workflow passes the repository secret of that name.

## Step 5: statistics

After the Linux checkout on the `main` branch, the same action runs `script/patches-stats.mjs --upload-stats`. The script counts patch files and the lines in them, using each target's `.patches` list, and the step is non-fatal (`|| true`).

## Local validation

The repository's `lint-staged` configuration runs two checks whenever a `.patch` or `.patches` file is staged:

- `node script/lint.js --patches --only --`, which checks each target in `patches/config.json`. It verifies that the target directory exists, that a `.patches` file is present, that no patch is listed twice, and that the listed files exist.
- `ts-node script/check-patch-diff.ts`, which runs the export in dry-run mode and fails if that run fails. It does not compare the exported output with the committed files.

## Hash for the dependency cache

`script/generate-deps-hash.js` writes `.depshash`. It hashes `DEPS`, `yarn.lock`, `script/sysroots.json`, the checkout action, and every file under `patches/`, with a per-platform hash version. The CI workflows use this hash as a cache key, so any change to `DEPS` or to the patches invalidates cached checkouts.

## Failure behavior

- A patch that fails to apply stops the sync hook. The job fails and the matcher points to the file.
- A patch set that differs from what was committed fails the checkout step, either after an automatic push or with a patch artifact.
- Lint fails if a target directory or a `.patches` file is missing, or if a patch is listed twice.

## Related pages

- [Chromium, Node, and V8 Patch Stack](../integrations/chromium-node-v8-patches.md)
- [CI Pipelines and Release Automation](ci-pipelines.md)
- [Building Electron with GN and Ninja](build-and-gn.md)
