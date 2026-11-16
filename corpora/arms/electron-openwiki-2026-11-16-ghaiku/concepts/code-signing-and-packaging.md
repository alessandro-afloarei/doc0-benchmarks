---
type: concept
title: Code Signing, Packaging, and Distribution Artifacts
description: How Electron's release artifacts are assembled and checked. Covers the dist and chromedriver zips and their manifests, symbol zips and dSYM handling, binary and framework stripping, the macOS Mac App Store build configuration, Info.plist hash substitution, and the local code-signing identity helpers used by tests.
tags: [packaging, code-signing, zip, symbols, dsym, manifests, mas, release-artifacts]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T11:29:50.477Z
sources:
  - id: openwiki-source-757d9d2fe211560800b04a7b
    resource: repo://.github/actions/build-electron/action.yml
  - id: openwiki-source-027176834713418d66b4f8b6
    resource: repo://build/zip.py
  - id: openwiki-source-54db02289c3f3bfe4b8556c9
    resource: repo://script/codesign/get-trusted-identity.sh
  - id: openwiki-source-a6a20bdbabf50e7e56c159f3
    resource: repo://script/generate-mas-config.py
  - id: openwiki-source-7416b5cb14077ea7ee591178
    resource: repo://script/gn-plist-but-with-hashes.js
  - id: openwiki-source-2cca80332ef845ce0e1b5146
    resource: repo://script/zip_manifests/check-zip-manifest.py
  - id: openwiki-source-59f4df73e479eb7ed742144a
    resource: repo://script/zip-symbols.py
generated: { by: "claude-code", at: "2026-11-16T11:29:50.477Z" }
---

# Code Signing, Packaging, and Distribution Artifacts

Electron's build produces a set of distributable artifacts for each platform and architecture. The GN build creates the application bundle or directory and zips it. Scripts under `build/` and `script/` strip binaries, package debug symbols, check the zip contents against committed manifests, and generate build-time configuration for signing and for the Mac App Store variant. This page describes those pieces. The signing identity helpers in `script/codesign/` are mainly used for local and test signing.

## Zip packaging

- `build/zip.py` builds the distribution zip from the output directory. It keeps a list of extensions to skip (for example `.pdb`, `.mojom.js`, and `.info`) and a list of path prefixes to skip (for example `angledata`, Vulkan mock ICDs, and the `Electron.dSYM` bundle). These exclusions keep Chromium test-only outputs out of the shipped zip.
- `script/zip-symbols.py` creates `symbols.zip` from the `breakpad_symbols` directory. On macOS it also creates `dsym.zip` from the `*.dSYM` bundles, and it leaves out the `v8_context_snapshot_generator.dSYM` bundle, which is handled as a separate snapshot archive. The CI build action calls it after the build and can delete the dSYM directories after zipping (`DELETE_DSYMS_AFTER_ZIP`).
- `build/dump_syms.py` runs the Breakpad `dump_syms` tool and reads the `MODULE <platform> <arch> <hash> <name>` header of each binary to name the symbol output.

## Manifests: the zip contents contract

`script/zip_manifests/` holds one manifest per shipped zip, per platform and architecture. The file names follow the pattern `dist_zip.<platform>.<arch>.manifest` and `chromedriver_zip.<platform>.<arch>.manifest`. Each manifest lists the expected archive entries, one per line. `script/zip_manifests/check-zip-manifest.py` compares a zip against its manifest. It reports entries that were added and entries that were removed, and it returns a non-zero status if they differ. The build action runs this check on `dist.zip` and `chromedriver.zip` in `.github/actions/build-electron/action.yml`.

`script/generate-zip-manifest.py` is the reverse operation. It writes a sorted list of entry names from an existing zip, so a manifest can be regenerated when a deliberate packaging change is made. Changing what ships therefore requires updating the manifest in the same change, and the CI check is what enforces that.

## Stripping and framework trimming

- `build/linux/strip_binary.py` strips a Linux binary using LLVM tools (`llvm-strip` and `llvm-objcopy`). It can also compress the debug sections.
- `build/strip_framework.py` copies a macOS framework into the output and removes its `Headers` directories so headers are not shipped. It is called from the GN build around line 993 of `BUILD.gn`.
- `build/mac/make_locale_dirs.py` creates locale directories for the macOS bundle; `BUILD.gn` runs it around line 1063.

## Info.plist hash substitution

`script/gn-plist-but-with-hashes.js` fills placeholders in an `Info.plist` template. Each `${KEY}` placeholder is replaced with the contents of a file given on the command line. It is invoked from `build/asar.gni`, which fills the plist with values derived from the packaged app archive. The asar integrity check that consumes that value is described in [Fuses and ASAR Integrity](fuses-and-integrity.md).

## Mac App Store configuration

`script/generate-mas-config.py` writes a generated C header, `ELECTRON_GEN_MAS_BUILD_H_`, that defines `IS_MAS_BUILD()` as `1` or `0`. `build/config/BUILD.gn` calls it for the build. Code that differs for Mac App Store builds checks this macro at compile time, so the same sources build both variants. The macOS MAS packaging also uses `dist_zip.mac_mas.*` manifests, so the MAS and non-MAS contents are tracked separately.

## Code-signing identity helpers

`script/codesign/` contains helpers for signing identities that are used in local development and in tests:

- `get-trusted-identity.sh` prints the first valid code-signing identity from `security find-identity` on macOS, or prints nothing when none is available. `spec/lib/codesign-helpers.ts` calls it.
- `generate-identity.sh` creates a self-signed certificate with OpenSSL, using `codesign.cnf`, and then runs `gen-trust.ts` to produce a trust settings file from the template `trust.xml`. `gen-trust.ts` reads the certificate's SHA-1 fingerprint and serial number through OpenSSL and fills them into the template.

These helpers are not the production signing path, and this page does not describe how release builds are signed. For where packaging and publishing run, see [CI Pipelines and Release Automation](../workflows/ci-pipelines.md).

## Failure behavior

- A zip whose contents differ from its manifest fails `check-zip-manifest.py`, which fails the build action. The manifest must be updated deliberately.
- `get-trusted-identity.sh` exits with status 0 when no identity exists and prints nothing, so callers must check for empty output.
- `strip_framework.py` removes the destination before copying and raises through `check_output` if a copy or removal fails.

## Related pages

- [Building Electron with GN and Ninja](../workflows/build-and-gn.md) describes the build that produces these artifacts.
- [CI Pipelines and Release Automation](../workflows/ci-pipelines.md) describes where packaging, signing, and publishing run.
- [Fuses and ASAR Integrity](fuses-and-integrity.md) covers the integrity values carried in the plist.

## Focused tests

- `spec/lib/codesign-helpers.ts` provides the helper used by signing-related specs.
- `spec/fuses-spec.ts` and `spec/asar-integrity-spec.ts` cover the runtime side of integrity.
