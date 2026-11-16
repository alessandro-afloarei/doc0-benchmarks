---
type: system
title: ASAR archive support
description: How Electron reads .asar archives — the native header parser and file extraction in shell/common/asar, the Node fs/child_process/module patches in lib/node/asar-fs-wrapper.ts, file:// loading through AsarURLLoaderFactory, unpacked files, per-file and header integrity validation, and the fuses and environment variables that control ASAR behavior.
tags: [asar, fs, node, integrity, security, fuses]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T08:25:33.723Z
sources:
  - id: openwiki-source-948a7a9d83defa7e291d47d4
    resource: repo://build/fuses/fuses.json5
  - id: openwiki-source-fc70a27ce2ad9ad66fb961ef
    resource: repo://lib/node/asar-fs-wrapper.ts
  - id: openwiki-source-0b7fa519832032182e66e802
    resource: repo://lib/node/init.ts
  - id: openwiki-source-31e7b62373a9b2e00ddfe2fa
    resource: repo://shell/browser/net/asar/asar_file_validator.cc
  - id: openwiki-source-d885d8409dce109998cad17e
    resource: repo://shell/browser/protocol_registry.cc
  - id: openwiki-source-dc18a0674c36202c6677a719
    resource: repo://shell/common/asar/archive_mac.mm
  - id: openwiki-source-a89ef9ad256a54e04eef520b
    resource: repo://shell/common/asar/archive_win.cc
  - id: openwiki-source-a80d965312b6d4ace23f3bad
    resource: repo://shell/common/asar/archive.cc
generated: { by: "claude-code", at: "2026-11-16T08:25:33.723Z" }
---

# ASAR archive support

ASAR is Electron's simple archive format for packaging an app
(`resources/app.asar`). Electron makes archives behave like read-only
directories for Node's `fs`, `require`, `child_process` and for `file://`
loads in web contents, so an app can run from an archive without extracting
it.

## Format and native reader

An archive is: an 8-byte Chromium `Pickle` holding the header size, a pickled
JSON header string, and then the concatenated file contents. The JSON header
is a tree of `files` entries carrying `size`, `offset` (relative to the end of
the header), `unpacked`, `executable`, `link` and optional `integrity`
(`algorithm`, `hash`, `blockSize`, `blocks`).

`asar::Archive` (`shell/common/asar/archive.cc`) owns one opened archive:

- `Init()` reads and parses the header (once; a missing file returns false
  quietly, other errors are logged). File offsets are rebased by
  `header_size_ = 8 + size`.
- `GetFileInfo` / `Stat` / `Readdir` / `Realpath` answer queries from the
  header without reading file data.
- `CopyFileOut(path)` gives callers a **real filesystem path** for a file:
  unpacked files resolve to `<archive>.asar.unpacked/<path>`; packed files
  are copied into a `ScopedTemporaryFile` (made executable on POSIX if marked
  so), cached per archive for reuse. This is how APIs that need an OS path
  (`process.dlopen`, `child_process.execFile`, `fs.open`) work.
- `shell/common/asar/asar_util.cc` provides `GetOrCreateAsarArchive` caching
  and path splitting; the `electron_common_asar` binding
  (`shell/common/api/electron_api_asar.cc`) exposes `Archive` and `splitPath`
  to JS.

### Integrity

When the **EmbeddedAsarIntegrityValidation** fuse is enabled (macOS and
Windows), `Init()` looks up the expected header hash for the archive's path
relative to the app — from `ElectronAsarIntegrity` in `Info.plist` on macOS
(`archive_mac.mm`) or an `Integrity/ElectronAsar` resource on Windows
(`archive_win.cc`) — and calls `ValidateIntegrityOrDie`. A missing or
unsupported integrity entry, or a mismatch, is **fatal** (`LOG(FATAL)`).
Only after header validation are per-file `integrity` blocks loaded; a
validated header with a malformed file integrity entry is also fatal.

Per-file integrity is then enforced on reads:

- in JS, `validateBufferIntegrity` hashes the bytes read by
  `fs.readFile(Sync)` and calls `process.exit(1)` with
  `ASAR Integrity Violation` on mismatch;
- in the network stack, `AsarFileValidator`
  (`shell/browser/net/asar/asar_file_validator.cc`) hashes streamed data block
  by block and aborts on mismatch;
- `ScopedTemporaryFile::InitFromFile` validates extracted copies.

The build template `asar_hashed_info_plist` (`build/asar.gni`, via
`script/gn-plist-but-with-hashes.js`) injects hashes into the macOS plist;
packagers such as `@electron/asar` / Electron Forge do the same for apps.

## Node integration: `lib/node/asar-fs-wrapper.ts`

`lib/node/init.ts` — the `node_init` bundle that runs in every Node
environment — first calls `wrapFsWithAsar(require('fs'))`. The wrapper:

- **splits paths** with the native `splitPath` into `{ isAsar, asarPath,
  filePath }`; anything not inside an archive goes to the original function.
- caches `Archive` objects per path (`getOrCreateArchive`), and lends this
  helper to `lib/browser/init.ts` as `process._getOrCreateArchive` for app
  discovery.
- re-implements metadata and read APIs against the header: `stat`/`lstat`
  (synthesised `Stats` with the process uid/gid and a fixed time),
  `exists`, `access`, `realpath`, `readdir` (including `withFileTypes`),
  `readFile`/`readFileSync`/`promises.readFile` (reading the byte range
  directly from the archive fd, or via `copyFileOut` for unpacked files),
  plus Node's internal `internalModuleStat` and module
  resolution so `require()` works inside archives.
- rejects writes into archives: `mkdir` inside an archive raises `ENOTDIR`.
- routes path-only consumers through `copyFileOut`: `copyFile`, `open`,
  `openSync`, `process.dlopen` and `Module._extensions['.node']` (native
  modules), and lazily `child_process.execFile`/`execFileSync`. `exec` and
  `execSync` run with ASAR disabled because their command strings are not
  paths.
- errors mimic Node: `ENOENT`, `ENOTDIR`, and `Invalid package` for corrupt
  archives.

### Disabling and debugging

- `process.noAsar = true` disables the wrapper at runtime (checked on every
  call).
- `ELECTRON_NO_ASAR` disables it only in non-browser, non-renderer processes
  (e.g. `ELECTRON_RUN_AS_NODE` children).
- `ELECTRON_LOG_ASAR_READS` appends `offset: path` lines to
  `<name>-access-log.txt` in the temp dir — useful for ordering files in
  an archive.
- The `original-fs` builtin (injected by Electron's Node js2c patch) provides
  unpatched `fs`.

## Web contents: `file://` inside archives

`ProtocolRegistry::RegisterURLLoaderFactories`
(`shell/browser/protocol_registry.cc`) replaces Chromium's `file:` loader
factory with `AsarURLLoaderFactory` (`shell/browser/net/asar/`), a
modified `FileURLLoader` that serves files from archives, including range
requests and integrity validation. This only happens when the
**GrantFileProtocolExtraPrivileges** fuse is on; with it off, `file://`
uses Chromium's default behavior and cannot read into archives. DevTools
(`inspectable_web_contents.cc`) and the proxying loader factory reuse the same
loader.

## Fuses

| Fuse | Effect |
| --- | --- |
| `only_load_app_from_asar` | the browser process only searches `app.asar` for the app (no `app/` folder or `default_app.asar`) |
| `embedded_asar_integrity_validation` | header hash validation on macOS/Windows as above |
| `grant_file_protocol_extra_privileges` | enables the ASAR-aware `file://` loader |

Fuse mechanics are described in [Fuses and build flags](fuses-and-build-flags.md);
how the app archive is located at startup is in
[Process model and main-process startup](../architecture/process-model-and-startup.md).
