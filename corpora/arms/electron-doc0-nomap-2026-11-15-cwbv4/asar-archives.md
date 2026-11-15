---
title: "ASAR Archives"
---
## Overview

Electron apps are usually shipped as one `app.asar` file: a simple archive that concatenates the app's files after a JSON index. Electron reads it in place, so code can `require('./lib/x')`, call `fs.readFileSync` or load `file:///…/app.asar/index.html` as if `app.asar` were a directory. Three layers make that work: a C++ `asar::Archive` that parses the format, a TypeScript wrapper that patches Node's `fs`, `child_process` and module loader in every Node-backed process, and an asar-aware URL loader for `file:` requests in Chromium. Optional integrity checks verify the archive against hashes embedded in the signed executable. The fuses that turn integrity checking and asar-only loading on are listed in [[Fuses]].

Sources: [shell/common/asar/archive.cc:189-268](repo://shell/common/asar/archive.cc#L189-L268), [lib/node/init.ts:1-5](repo://lib/node/init.ts#L1-L5), [shell/browser/protocol_registry.cc:23-41](repo://shell/browser/protocol_registry.cc#L23-L41)

## The archive format

### Header

An archive starts with an 8-byte Chromium `Pickle` holding the header size, followed by a pickled string containing JSON. `Archive::Init` reads both, and the file data begins right after, at offset `8 + size`. The JSON is a tree: directories have a `files` object, files have `size`, `offset` (a string, relative to the end of the header), and optional `unpacked`, `executable` and `integrity` fields, and symlinks have a `link` path.

Sources: [shell/common/asar/archive.cc:189-268](repo://shell/common/asar/archive.cc#L189-L268), [shell/common/asar/archive.cc:40-115](repo://shell/common/asar/archive.cc#L40-L115)

### Lookups

`GetNodeFromPath` walks the tree one path component at a time, following `link` entries on directories. `GetFileInfo`, `Stat`, `Readdir` and `Realpath` all start there: `Stat` reports links and directories as such, and `GetFileInfo` resolves a file's size and absolute offset. An unpacked file has no offset; it lives on disk next to the archive.

Sources: [shell/common/asar/archive.cc:40-90](repo://shell/common/asar/archive.cc#L40-L90), [shell/common/asar/archive.cc:279-354](repo://shell/common/asar/archive.cc#L279-L354)

### Unpacked files and extraction

Some files cannot be read from inside an archive by their consumer, such as native modules loaded by `dlopen`. Packaging tools put those in an `app.asar.unpacked` directory and mark them `unpacked` in the header. `Archive::CopyFileOut` returns the path inside `<archive>.unpacked` for such files; for packed files it extracts the bytes to a `ScopedTemporaryFile` (verifying integrity on the way, and making it executable when the header says so), caches it for the archive's lifetime, and returns the temporary path.

Sources: [shell/common/asar/archive.cc:356-393](repo://shell/common/asar/archive.cc#L356-L393)

### Finding and caching archives

`GetAsarArchivePath` splits a path into the archive and the path inside it by walking up from the full path until it finds a component ending in `.asar` that is not a real directory (directory checks are cached). `GetOrCreateAsarArchive` keeps one `Archive` per archive path in a locked process-wide map, so a header is parsed once. `asar::ReadFileToString` combines the two for C++ callers that need a file's contents.

Sources: [shell/common/asar/asar_util.cc:30-135](repo://shell/common/asar/asar_util.cc#L30-L135)

## Integrity

### Header integrity

On macOS and Windows, when the `EmbeddedAsarIntegrityValidation` fuse is on and the archive is inside the app's resources, `Archive::Init` looks up the expected SHA-256 of the header: on macOS from the `ElectronAsarIntegrity` dictionary in the app's `Info.plist`, keyed by the archive's relative path; on Windows from an `Integrity` resource in the executable. A missing entry or a mismatch is fatal. Because the executable is code-signed, a valid signature then covers the archive's index.

Sources: [shell/common/asar/archive.cc:235-260](repo://shell/common/asar/archive.cc#L235-L260), [shell/common/asar/archive_mac.mm:34-66](repo://shell/common/asar/archive_mac.mm#L34-L66), [shell/common/asar/archive_win.cc:25-60](repo://shell/common/asar/archive_win.cc#L25-L60), [shell/common/asar/asar_util.cc:137-150](repo://shell/common/asar/asar_util.cc#L137-L150)

### File integrity

Once the header is trusted, each file's `integrity` entry (algorithm, whole-file hash, block size and per-block hashes) is trusted too, and with the fuse on a file without one is fatal. Readers check what they read: `ReadFileToString` and `CopyFileOut` hash the whole file, the JavaScript wrapper hashes buffers it reads and exits the process on a mismatch, and the URL loader streams through `AsarFileValidator`, which hashes each block as it passes and aborts on the first bad block.

Sources: [shell/common/asar/archive.cc:119-155](repo://shell/common/asar/archive.cc#L119-L155), [lib/node/asar-fs-wrapper.ts:254-265](repo://lib/node/asar-fs-wrapper.ts#L254-L265), [shell/browser/net/asar/asar_file_validator.cc:43-132](repo://shell/browser/net/asar/asar_file_validator.cc#L43-L132)

## The Node.js fs wrapper

### Installation

`lib/node/init.ts` is the `node_init` bundle that runs before every Node environment's own bootstrap ([[Node.js Integration and Event Loops]]). Its first act is `wrapFsWithAsar(require('fs'))`. The wrapper uses the `electron_common_asar` binding, whose `Archive` class exposes `getFileInfo`, `stat`, `readdir`, `realpath`, `copyFileOut` and `getFdAndValidateIntegrityLater`, plus `splitPath`. JavaScript `Archive` objects are cached by path, and the helper is exposed once as `process._getOrCreateArchive` for the main-process bootstrap to take ([[Main Process Bootstrap]]).

Sources: [lib/node/init.ts:1-5](repo://lib/node/init.ts#L1-L5), [shell/common/api/electron_api_asar.cc:16-33](repo://shell/common/api/electron_api_asar.cc#L16-L33), [lib/node/asar-fs-wrapper.ts:9-47](repo://lib/node/asar-fs-wrapper.ts#L9-L47)

Asar support can be turned off with `process.noAsar = true`, or with the `ELECTRON_NO_ASAR` environment variable in processes other than the main process and renderers.

Sources: [lib/node/asar-fs-wrapper.ts:15-18](repo://lib/node/asar-fs-wrapper.ts#L15-L18)

### Three ways of wrapping

Each patched function first calls `splitPath` on its path argument and calls the original when the path is not inside an archive.

Sources: [lib/node/asar-fs-wrapper.ts:71-90](repo://lib/node/asar-fs-wrapper.ts#L71-L90)

| Strategy | Used for | How |
| --- | --- | --- |
| Reimplement | `stat`, `lstat`, `exists`, `access`, `realpath`, `readFile`, `readdir` and their sync and promise forms | Answer from the archive's index and file data directly |
| Extract then delegate (`overrideAPI`, `overrideAPISync`) | `open`, `copyFile`, `process.dlopen`, `require` of `.node` files, `child_process.execFile` | Replace the path argument with the result of `copyFileOut` |
| Refuse | `mkdir` inside an archive | Throw `ENOTDIR` |

Sources: [lib/node/asar-fs-wrapper.ts:185-252](repo://lib/node/asar-fs-wrapper.ts#L185-L252), [lib/node/asar-fs-wrapper.ts:290-400](repo://lib/node/asar-fs-wrapper.ts#L290-L400), [lib/node/asar-fs-wrapper.ts:1186-1239](repo://lib/node/asar-fs-wrapper.ts#L1186-L1239)

Errors mimic the real file system: a missing entry is `ENOENT, <file> not found in <archive>`, and an unreadable archive is reported as invalid. Stats for archive entries use the process's UID and GID and a fixed timestamp.

Sources: [lib/node/asar-fs-wrapper.ts:92-183](repo://lib/node/asar-fs-wrapper.ts#L92-L183)

### Reading a file

`readFileSync` on an archive path gets the file info, returns an empty result for zero-length files, reads unpacked files from disk, and otherwise reads `size` bytes at `offset` from the archive's file descriptor into a buffer, then validates its integrity. With `ELECTRON_LOG_ASAR_READS` set, every such read is appended with its offset to `<archive>-access-log.txt` in the temporary directory.

Sources: [lib/node/asar-fs-wrapper.ts:657-716](repo://lib/node/asar-fs-wrapper.ts#L657-L716), [lib/node/asar-fs-wrapper.ts:290-305](repo://lib/node/asar-fs-wrapper.ts#L290-L305)

### The module loader

Node's resolver does not call the public `fs` functions; it uses the internal `internalModuleStat` binding to probe for files and directories. The wrapper replaces that binding so `require` can find `package.json`, `index.js` and nested `node_modules` inside an archive.

Sources: [lib/node/asar-fs-wrapper.ts:1012-1030](repo://lib/node/asar-fs-wrapper.ts#L1012-L1030)

### child_process

`child_process` is patched lazily, the first time it is loaded, unless `ELECTRON_EAGER_ASAR_HOOK_FOR_TESTING` is set. `execFile` extracts an archived executable before running it. `exec` and `execSync` run with asar disabled, because their command string is passed to `execFile` internally and would otherwise be mistaken for an archive path.

Sources: [lib/node/asar-fs-wrapper.ts:1241-1279](repo://lib/node/asar-fs-wrapper.ts#L1241-L1279)

`lib/node/init.ts` also patches `child_process.fork` so a forked script runs Electron as plain Node, setting `ELECTRON_RUN_AS_NODE=1` and, on macOS, using the helper executable. It filters `Module._nodeModulePaths` so modules inside the resources directory never search `node_modules` folders outside it.

Sources: [lib/node/init.ts:15-59](repo://lib/node/init.ts#L15-L59)

## Loading archives over file: URLs

Pages loaded with `loadFile` reach the archive through Chromium, not Node. When the `GrantFileProtocolExtraPrivileges` fuse is on, `ProtocolRegistry` installs `AsarURLLoaderFactory` for `file:` ([[Custom Protocols and Request Interception]]). Its loader splits the path with `GetAsarArchivePath`; ordinary files are served normally, and archive entries are found with `GetFileInfo`. Unpacked entries are read from their real path; packed ones are streamed from the archive file at their offset, through an `AsarFileValidator` when the entry has integrity data.

Sources: [shell/browser/protocol_registry.cc:23-41](repo://shell/browser/protocol_registry.cc#L23-L41), [shell/browser/net/asar/asar_url_loader.cc:105-170](repo://shell/browser/net/asar/asar_url_loader.cc#L105-L170)
