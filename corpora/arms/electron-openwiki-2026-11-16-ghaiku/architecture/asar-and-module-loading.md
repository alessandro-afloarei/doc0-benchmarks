---
type: architecture
title: ASAR Archives and Module Loading
description: How Electron loads application code from ASAR archives, how the fs and Node module resolver are patched to read from them, how the app entry is searched, and which fuses and integrity checks gate that loading.
tags: [asar, module-loading, fs, fuses, integrity, node]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T11:29:50.477Z
sources:
  - id: openwiki-source-8a35ee6a27dea5f50a49b698
    resource: repo://build/fuses/build.py
  - id: openwiki-source-948a7a9d83defa7e291d47d4
    resource: repo://build/fuses/fuses.json5
  - id: openwiki-source-fc70a27ce2ad9ad66fb961ef
    resource: repo://lib/node/asar-fs-wrapper.ts
  - id: openwiki-source-0b7fa519832032182e66e802
    resource: repo://lib/node/init.ts
  - id: openwiki-source-7f3026761c06b71bedda7de1
    resource: repo://shell/app/electron_main_delegate.cc
  - id: openwiki-source-a80d965312b6d4ace23f3bad
    resource: repo://shell/common/asar/archive.cc
  - id: openwiki-source-7a563f98407b944e8311fdf4
    resource: repo://shell/common/node_bindings.cc
generated: { by: "claude-code", at: "2026-11-16T11:29:50.477Z" }
---

# ASAR Archives and Module Loading

An ASAR file is a single-file archive that packs an app's JavaScript and assets. Electron lets an unmodified Node.js `fs` and module system read files from inside an `.asar` path as if they were directories. The support is split between a C++ archive reader in `shell/common/asar/`, a JavaScript `fs` wrapper in `lib/node/`, and startup logic that chooses which archive to run.

## Responsibilities

- **C++ archive reader** (`shell/common/asar/archive.{h,cc}`): parses the ASAR header, answers `stat`, `readdir`, `realpath`, and file-info queries, copies files out for "unpacked" entries, and optionally verifies header and per-file integrity hashes.
- **Path resolution** (`shell/common/asar/asar_util.cc`): `GetAsarArchivePath` walks up from a full path until it finds a component ending in `.asar` that is not a real directory, then splits the path into archive path and relative tail. Archives are cached by path in `GetOrCreateAsarArchive`, so each archive is parsed once per process.
- **JavaScript `fs` wrapper** (`lib/node/asar-fs-wrapper.ts`): `wrapFsWithAsar` replaces the synchronous, callback, and promise `fs` entry points for paths that resolve into an archive. `getOrCreateArchive` keeps a JS-side cache of `asar.Archive` objects, which are the native bindings from `shell/common/api/electron_api_asar.cc`.
- **Module hook** (`lib/node/init.ts`): this is the per-process init for the Node environment. It calls `wrapFsWithAsar(require('fs'))`, hooks `child_process.fork` so forked children run the Electron binary with `ELECTRON_RUN_AS_NODE=1`, and narrows `Module._nodeModulePaths` so that code inside `process.resourcesPath` cannot resolve modules from directories outside the app's resources tree.

## Startup: choosing the app to run

`shell/common/node_bindings.cc` builds the list of candidate app entries that the browser-side init script searches. In the browser process the search list is `app.asar`, `app`, and `default_app.asar`, in that order. When the `only_load_app_from_asar` fuse is enabled, the list is reduced to `app.asar` only. The same fuse value is also exposed as `appSearchPathsOnlyLoadASAR`. Non-browser process types do not receive these private values.

`default_app/main.ts` is the fallback application that Electron runs when no app is found. It reads `process.defaultApp` and loads its own bundled `default_app.js`, which is why the `default_app` entry appears last in the search list.

## Integrity validation

Integrity is gated by the `embedded_asar_integrity_validation` fuse, read through `electron::fuses::IsEmbeddedAsarIntegrityValidationEnabled()`:

- When the fuse is on and the platform is macOS or Windows, `Archive::Init` requires a header integrity payload. If one is missing for a validatable archive, the process hits a `LOG(FATAL)`. `Archive::GetFileInfo` reads per-file `integrity` blocks (algorithm, hash, block size, and block hashes) from the header.
- The V8 startup snapshot is also checked. `ValidateV8Snapshot` in `shell/app/electron_main_delegate.cc` compares the SHA-256 of the snapshot data with a compiled-in checksum and `CHECK`s on mismatch.

Consequence: enabling the fuse ties the packaged archive and the snapshot to the build, so a tampered archive fails closed at startup rather than running modified code.

## Fuses that control loading

Fuses are compile-time booleans defined in `build/fuses/fuses.json5` and written by `build/fuses/build.py` into generated `fuses.h` and `fuses.cc`. The relevant ones are:

| Fuse | Effect on loading |
| --- | --- |
| `run_as_node` | Gates `ELECTRON_RUN_AS_NODE` handling in the platform entry points (`electron_main_linux.cc`, `electron_main_mac.cc`, `electron_main_win.cc`). |
| `node_options` | Gates `NODE_OPTIONS` processing in `node_bindings.cc` and `node_main.cc`. |
| `only_load_app_from_asar` | Restricts the app search list described above. |
| `embedded_asar_integrity_validation` | Enables the header and snapshot checks above. |

Fuse values are read at runtime from a sentinel-marked byte wire in the binary. A `--set-fuse-<name>` command-line switch overrides the value only in DCHECK builds.

## Failure behavior

- If `getOrCreateArchive` cannot open a path, the wrapper falls back to the ordinary `fs` behavior for that path, so a missing or corrupt `.asar` surfaces as a normal file-not-found or parse failure instead of a crash.
- Unpacked entries (`unpacked: true` in the header) are returned as real on-disk paths by `CopyFileOut`, so native code and child processes can use them directly.
- Integrity failures are fatal by design; they are not reported to JavaScript.

## Related pages

- [Process Model and Startup](process-model.md) explains which processes run the init modules that install these hooks.
- [Fuses and ASAR Integrity](../concepts/fuses-and-integrity.md) covers how fuse values are chosen and flipped.

## Focused tests

- `spec/asar-spec.ts` exercises archive reads, directory traversal, and unpacked files.
- `spec/asar-integrity-spec.ts` and `spec/fixtures/test.asar` cover integrity-enabled loading.
- `spec/fuses-spec.ts` checks fuse behavior.
