---
title: "ASAR Archives"
---
## Overview

Packaged Electron apps usually ship their code as `resources/app.asar`, a single archive file, instead of a directory tree. Electron reads inside archives transparently. Node's `fs` and `require` see `app.asar/...` as a read-only directory, `file:` URLs load from it in pages, and `child_process.execFile` can run a binary stored in it. One C++ reader, `asar::Archive`, does the parsing. Two adapters sit on top: a patched `fs` in every Node environment, and an `AsarURLLoaderFactory` for `file:` requests in the browser process.

Sources: [shell/common/asar/archive.cc:189-267](repo://shell/common/asar/archive.cc#L189-L267), [lib/node/init.ts:1-4](repo://lib/node/init.ts#L1-L4), [shell/browser/protocol_registry.cc:24-46](repo://shell/browser/protocol_registry.cc#L24-L46)

[[Process Startup]] shows how the browser finds `app.asar` among the app search paths. [[Fuses]] lists the switches that can force ASAR-only loading and integrity checks.

Sources: [lib/browser/init.ts:82-112](repo://lib/browser/init.ts#L82-L112), [build/fuses/fuses.json5:9-10](repo://build/fuses/fuses.json5#L9-L10)

## The archive format

### Header and nodes

An archive begins with two Chromium pickles. The first 8 bytes are a pickle holding a `uint32` with the size of the header pickle. The header pickle holds one string, a JSON tree. File contents follow the header, so a file's offset in the JSON is relative to the end of the header, and the reader adds `8 + size` to it.

Sources: [shell/common/asar/archive.cc:202-267](repo://shell/common/asar/archive.cc#L202-L267), [shell/common/asar/archive.cc:108-114](repo://shell/common/asar/archive.cc#L108-L114)

The JSON tree has three kinds of node:

Sources: [shell/common/asar/archive.cc:40-118](repo://shell/common/asar/archive.cc#L40-L118)

| Node | Keys | Meaning |
| --- | --- | --- |
| Directory | `files` | Child nodes by name |
| Link | `link` | A path inside the archive; directory links are followed when listing |
| File | `size`, `offset`, optional `unpacked`, `executable`, `integrity` | Contents at `offset`, or outside the archive when `unpacked` |

Sources: [shell/common/asar/archive.cc:43-118](repo://shell/common/asar/archive.cc#L43-L118), [shell/common/asar/archive.cc:295-315](repo://shell/common/asar/archive.cc#L295-L315)

`GetNodeFromPath` walks the tree by splitting the path on `/`, or on `\` and `/` on Windows. `GetFileInfo` follows a file link to its target, while `Stat` reports a link as a link. `Readdir` lists a directory's `files` keys, and `Realpath` returns a link's target.

Sources: [shell/common/asar/archive.cc:69-89](repo://shell/common/asar/archive.cc#L69-L89), [shell/common/asar/archive.cc:279-354](repo://shell/common/asar/archive.cc#L279-L354)

### Unpacked files

Files that must exist on disk, such as native modules, are packed with `unpacked: true`. Their bytes live in a sibling directory, `app.asar.unpacked`, at the same relative path. `CopyFileOut` returns that real path for them. For packed files it copies the bytes into a `ScopedTemporaryFile` (made executable on POSIX when `executable` is set) and caches the copy per path, so each file is extracted at most once per archive.

Sources: [shell/common/asar/archive.cc:356-394](repo://shell/common/asar/archive.cc#L356-L394)

## Opening archives and splitting paths

`GetOrCreateAsarArchive` keeps a process-wide map from archive path to `shared_ptr<Archive>`, guarded by a lock. An archive that fails `Init` is not cached. `GetAsarArchivePath` finds the archive in a path by walking up from the full path to the first component that ends in `.asar` and is not a real directory. Directory checks are cached too, so the walk stays cheap.

Sources: [shell/common/asar/asar_util.cc:27-100](repo://shell/common/asar/asar_util.cc#L27-L100)

`ReadFileToString` is the C++ convenience reader. It reads a plain file normally, reads unpacked files from the unpacked directory, and otherwise reads the slice at the file's offset and validates it when it has integrity data.

Sources: [shell/common/asar/asar_util.cc:102-134](repo://shell/common/asar/asar_util.cc#L102-L134)

The `electron_common_asar` binding exposes this to JavaScript. Its `Archive` class has `getFileInfo`, `stat`, `readdir`, `realpath`, `copyFileOut` and `getFdAndValidateIntegrityLater`, which returns the archive's open file descriptor. `splitPath(path)` returns `{ isAsar, asarPath, filePath }`, allowing the archive itself as the path.

Sources: [shell/common/api/electron_api_asar.cc:20-33](repo://shell/common/api/electron_api_asar.cc#L20-L33), [shell/common/api/electron_api_asar.cc:179-228](repo://shell/common/api/electron_api_asar.cc#L179-L228)

## The fs wrapper

### Setup

`lib/node/init.ts` calls `wrapFsWithAsar(require('fs'))` in every Node environment, as [[Internal JavaScript Bundles]] shows. The wrapper first hides `process.internalBinding` from app code by deleting it after taking a reference. It caches `asar.Archive` objects per path, and exposes `getOrCreateArchive` once as `process._getOrCreateArchive` for the browser init script.

Sources: [lib/node/init.ts:1-4](repo://lib/node/init.ts#L1-L4), [lib/node/asar-fs-wrapper.ts:9-47](repo://lib/node/asar-fs-wrapper.ts#L9-L47)

### Deciding a path is inside an archive

`splitPath` is the gate every patched function goes through. It returns "not ASAR" at once when ASAR is disabled, when the argument is not a string, `Buffer` or `URL`, or when it does not contain `.asar` (case-insensitive). Only then does it call the native `splitPath` on the normalized path. ASAR is disabled by `process.noAsar`, or by `ELECTRON_NO_ASAR` in processes other than the browser and renderers.

Sources: [lib/node/asar-fs-wrapper.ts:15-18](repo://lib/node/asar-fs-wrapper.ts#L15-L18), [lib/node/asar-fs-wrapper.ts:49-49](repo://lib/node/asar-fs-wrapper.ts#L49-L49), [lib/node/asar-fs-wrapper.ts:71-87](repo://lib/node/asar-fs-wrapper.ts#L71-L87)

### Three ways to patch a function

Each patched `fs` function follows one of three patterns:

Sources: [lib/node/asar-fs-wrapper.ts:185-288](repo://lib/node/asar-fs-wrapper.ts#L185-L288)

- **Reimplemented on the archive.** `readFile`, `readFileSync`, `stat`, `lstat`, `readdir`, `realpath`, `exists`, `access` and their variants answer from the header and the archive's file descriptor. `readFileSync` reads `info.size` bytes at `info.offset` with `fs.readSync` and validates them. An unpacked file is read from its real path.
- **Redirected to a real file.** `overrideAPI` and `overrideAPISync` call `copyFileOut` and pass the extracted path to the original function. That covers `open`, `openSync`, `copyFile`, `process.dlopen`, `Module._extensions['.node']`, and `child_process.execFile` and `execFileSync`.
- **Disabled.** `child_process.exec` and `execSync` run with ASAR turned off, because, as the comment says, a command string that contains an archive path would otherwise be treated as one path.

Sources: [lib/node/asar-fs-wrapper.ts:676-721](repo://lib/node/asar-fs-wrapper.ts#L676-L721), [lib/node/asar-fs-wrapper.ts:1230-1252](repo://lib/node/asar-fs-wrapper.ts#L1230-L1252)

Archive entries get synthetic `Stats`: read permissions plus owner write, the type from the header, the size, a fresh inode number, the process's uid and gid, and the same fixed timestamp for all times. Errors mimic Node's, with `NOT_FOUND`, `NOT_DIR`, `NO_ACCESS` and `INVALID_ARCHIVE` mapped to `ENOENT`-style codes.

Sources: [lib/node/asar-fs-wrapper.ts:120-147](repo://lib/node/asar-fs-wrapper.ts#L120-L147), [lib/node/asar-fs-wrapper.ts:149-183](repo://lib/node/asar-fs-wrapper.ts#L149-L183)

`child_process` is patched lazily, the first time it is loaded through `Module._load`, so apps that never use it do not pay for it. `ELECTRON_EAGER_ASAR_HOOK_FOR_TESTING` patches it eagerly so stack traces match in Node's own tests.

Sources: [lib/node/asar-fs-wrapper.ts:1254-1280](repo://lib/node/asar-fs-wrapper.ts#L1254-L1280)

### Module resolution

`require` does not go through public `fs` calls. It calls the internal `internalModuleStat` binding to probe paths, so the wrapper replaces that function as well, and `require('./x')` inside `app.asar` resolves like on disk.

Sources: [lib/node/asar-fs-wrapper.ts:1012-1030](repo://lib/node/asar-fs-wrapper.ts#L1012-L1030)

### Debugging reads and original-fs

With `ELECTRON_LOG_ASAR_READS` set, every archive read appends `offset: path` to `<archive>-access-log.txt` in the temp directory, which helps order files in an archive.

Sources: [lib/node/asar-fs-wrapper.ts:290-300](repo://lib/node/asar-fs-wrapper.ts#L290-L300)

Code that needs to treat an `.asar` file as a plain file can require `original-fs`. The Node build patch generates it by copying Node's `fs` sources under `original-fs` names. The js2c patch lets `internal/fs/watchers` load twice without errors, so the copy never gets the wrapper.

Sources: [patches/node/build_add_gn_build_files.patch:413-416](repo://patches/node/build_add_gn_build_files.patch#L413-L416), [patches/node/build_modify_js2c_py_to_allow_injection_of_original-fs_and_custom_embedder_js.patch:1-10](repo://patches/node/build_modify_js2c_py_to_allow_injection_of_original-fs_and_custom_embedder_js.patch#L1-L10)

## Integrity validation

On macOS and Windows, the `embedded_asar_integrity_validation` fuse makes the reader verify archives inside the app bundle. `Archive::Init` asks `HeaderIntegrity()` for the expected header hash. On macOS that comes from the `ElectronAsarIntegrity` dictionary in the bundle's `Info.plist`, keyed by the archive's path relative to `Contents`. It validates the header's SHA-256 and kills the process with `LOG(FATAL)` on a mismatch, or when a validatable archive has no hash at all.

Sources: [shell/common/asar/archive.cc:234-256](repo://shell/common/asar/archive.cc#L234-L256), [shell/common/asar/archive_mac.mm:23-60](repo://shell/common/asar/archive_mac.mm#L23-L60), [shell/common/asar/asar_util.cc:136-149](repo://shell/common/asar/asar_util.cc#L136-L149)

Once the header is trusted, per-file integrity becomes mandatory. `FillFileInfoWithNode` reads each file's `integrity` (`algorithm`, `hash`, `blockSize`, `blocks`) and treats a missing or malformed entry as fatal. Readers then check the bytes: the fs wrapper hashes the whole buffer after `readFileSync` and exits on mismatch, and the URL loader checks block by block while streaming.

Sources: [shell/common/asar/archive.cc:120-153](repo://shell/common/asar/archive.cc#L120-L153), [lib/node/asar-fs-wrapper.ts:254-265](repo://lib/node/asar-fs-wrapper.ts#L254-L265), [shell/browser/net/asar/asar_url_loader.cc:150-165](repo://shell/browser/net/asar/asar_url_loader.cc#L150-L165)

## Loading file: URLs from archives

Pages request `file://.../app.asar/index.html` like any other file. When the `grant_file_protocol_extra_privileges` fuse is on, `ProtocolRegistry` installs `AsarURLLoaderFactory` for the `file` scheme, as [[Custom Protocols and the net Module]] describes. Service worker scripts on `file:` take the same loader through the web request proxy.

Sources: [shell/browser/protocol_registry.cc:24-46](repo://shell/browser/protocol_registry.cc#L24-L46), [shell/browser/net/proxying_url_loader_factory.cc:815-824](repo://shell/browser/net/proxying_url_loader_factory.cc#L815-L824)

`AsarURLLoader::Start` converts the URL to a path. A path that is not inside an archive goes to Chromium's ordinary file loader. Otherwise it looks the file up in the archive, failing with `ERR_FILE_NOT_FOUND`. It opens its own `base::File`, because the comment notes several requests may read the same archive at once. It wraps the reader in an `AsarFileValidator` when the file has integrity data, sniffs the MIME type from the first bytes, and honours a single-range `Range` header, rejecting anything else with `ERR_REQUEST_RANGE_NOT_SATISFIABLE`. The contents then stream through a Mojo data pipe.

Sources: [shell/browser/net/asar/asar_url_loader.cc:92-200](repo://shell/browser/net/asar/asar_url_loader.cc#L92-L200)
