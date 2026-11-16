---
title: "ASAR Archives"
---
## Overview

Most packaged Electron apps ship their code as a single `app.asar` file in the resources directory. An ASAR archive is one file holding a JSON index followed by the concatenated contents of every packed file. Electron makes paths inside an archive (`/path/to/app.asar/main.js`) behave like ordinary paths in three places: Node's `fs` and module loader, `file:` URLs loaded by pages and the `net` module, and Electron's own native code that reads files. On macOS and Windows an app can also embed hashes of its archives in the binary so that a tampered archive stops the process. Looking up the app in `app.asar` at startup is described in [[Main Process Startup and App Lifecycle]].

Sources: [shell/common/asar/archive.cc:189-267](repo://shell/common/asar/archive.cc#L189-L267), [lib/node/init.ts:3-5](repo://lib/node/init.ts#L3-L5), [shell/browser/net/asar/asar_url_loader.cc:100-133](repo://shell/browser/net/asar/asar_url_loader.cc#L100-L133)

## Archive format and the Archive class

### Reading the header

`asar::Archive` opens the file read-only and, in `Init`, reads an 8-byte Chromium `Pickle` holding the header size, then a second pickle of that size holding the header as a string. With the `embedded_asar_integrity_validation` fuse on (macOS and Windows), an archive inside the app bundle has its header string hashed and checked before parsing. The header is parsed as JSON into a dictionary, and the file data begins at `8 + size`.

Sources: [shell/common/asar/archive.cc:167-187](repo://shell/common/asar/archive.cc#L167-L187), [shell/common/asar/archive.cc:189-267](repo://shell/common/asar/archive.cc#L189-L267)

### The index

The index is a tree of nodes. Directories have a `files` dictionary; symlinks have a `link` path (a linked directory's `files` are read through the link); files have a `size`, an `offset` string relative to the end of the header, and optionally `unpacked`, `executable` and `integrity` (`algorithm`, `hash`, `blockSize`, `blocks`). `GetNodeFromPath` walks a relative path segment by segment, accepting both separators on Windows.

Sources: [shell/common/asar/archive.cc:40-156](repo://shell/common/asar/archive.cc#L40-L156)

### Operations

| Method | Behaviour |
| --- | --- |
| `GetFileInfo` | Follows links, fills size, absolute offset, `unpacked`, `executable` and integrity |
| `Stat` | Reports a link, a directory, or a file with its info |
| `Readdir` | Lists the names in a directory node |
| `Realpath` | Resolves links inside the archive |
| `CopyFileOut` | Returns a real filesystem path: `<archive>.unpacked/<path>` for unpacked files, otherwise a cached temporary copy (marked executable on POSIX when flagged) |
| `GetUnsafeFD` | The archive's own file descriptor, for direct reads |

Sources: [shell/common/asar/archive.cc:279-397](repo://shell/common/asar/archive.cc#L279-L397)

Unpacked files are those excluded from the archive at packaging time and stored beside it in `app.asar.unpacked`; their index entry has no offset. `CopyFileOut` exists because some consumers need a real file: native modules, executables, and APIs that pass a path to the OS.

Sources: [shell/common/asar/archive.cc:101-106](repo://shell/common/asar/archive.cc#L101-L106), [shell/common/asar/archive.cc:356-393](repo://shell/common/asar/archive.cc#L356-L393)

### Finding the archive in a path

`GetAsarArchivePath` walks up from the full path until it finds a component ending in `.asar` that is not a real directory (the check is cached), and splits the path into the archive path and the relative path inside it. `GetOrCreateAsarArchive` keeps one shared `Archive` per path under a lock and caches only archives that initialised successfully. `asar::ReadFileToString` uses both so native code can read a file whether it is inside an archive or not, verifying the file's hash when it has one.

Sources: [shell/common/asar/asar_util.cc:27-135](repo://shell/common/asar/asar_util.cc#L27-L135)

## Node.js fs integration

### Wrapping fs

`lib/node/init.ts` calls `wrapFsWithAsar(require('fs'))` in every process with Node. The wrapper talks to the `electron_common_asar` binding, which exposes an `Archive` class and `splitPath`, and caches one JS `Archive` per path. It also hands its `getOrCreateArchive` to `lib/browser/init.ts` as `process._getOrCreateArchive`, which uses it when the app may load only from `app.asar`.

Sources: [lib/node/init.ts:3-5](repo://lib/node/init.ts#L3-L5), [lib/node/asar-fs-wrapper.ts:9-47](repo://lib/node/asar-fs-wrapper.ts#L9-L47), [shell/common/api/electron_api_asar.cc:191-230](repo://shell/common/api/electron_api_asar.cc#L191-L230), [lib/browser/init.ts:86-100](repo://lib/browser/init.ts#L86-L100)

`splitPath` is the gate for every patched function. It returns "not asar" immediately when asar is disabled, when the argument is not a string, `Buffer` or `URL`, or when it does not contain `.asar`, and otherwise asks the native `splitPath`. Asar support is disabled by `process.noAsar`, or by `ELECTRON_NO_ASAR` in processes other than the browser and renderer.

Sources: [lib/node/asar-fs-wrapper.ts:15-18](repo://lib/node/asar-fs-wrapper.ts#L15-L18), [lib/node/asar-fs-wrapper.ts:70-87](repo://lib/node/asar-fs-wrapper.ts#L70-L87)

### Read-style APIs

The functions that read metadata or contents are reimplemented over the archive: `lstat`, `stat`, `realpath`, `exists`, `access`, `readFile`, `readdir` (including recursive and `withFileTypes` variants), and their sync and promise forms. Stats are synthesised as read-only files, directories or symlinks with the current uid and gid, a fake timestamp and an incrementing inode. Missing entries raise `ENOENT, <file> not found in <archive>`, and on Windows `mkdir` inside an archive raises `ENOTDIR` to match other platforms.

Sources: [lib/node/asar-fs-wrapper.ts:89-183](repo://lib/node/asar-fs-wrapper.ts#L89-L183), [lib/node/asar-fs-wrapper.ts:302-410](repo://lib/node/asar-fs-wrapper.ts#L302-L410), [lib/node/asar-fs-wrapper.ts:1188-1216](repo://lib/node/asar-fs-wrapper.ts#L1188-L1216)

`readFileSync` on a packed file allocates a buffer of the file's size, reads it from the archive's descriptor at the file's offset, and if the entry has integrity data hashes the buffer and exits the process with `ASAR Integrity Violation` on a mismatch. Empty files return an empty result, and unpacked files are read from their real path. Setting `ELECTRON_LOG_ASAR_READS` appends each read's offset and path to `<archive>-access-log.txt` in the temp directory.

Sources: [lib/node/asar-fs-wrapper.ts:253-265](repo://lib/node/asar-fs-wrapper.ts#L253-L265), [lib/node/asar-fs-wrapper.ts:290-300](repo://lib/node/asar-fs-wrapper.ts#L290-L300), [lib/node/asar-fs-wrapper.ts:677-724](repo://lib/node/asar-fs-wrapper.ts#L677-L724)

### Copy-out APIs

APIs that hand the path to the OS cannot read from an archive, so `overrideAPI` and `overrideAPISync` replace the path argument with `archive.copyFileOut(...)` and call the original. This covers `copyFile`, `open`, `openSync`, `process.dlopen` and the `.node` extension loader (so native modules inside an archive load from a temporary copy), and `child_process.execFile` and `execFileSync`. The async wrapper also patches the function's promisified form and `fs.promises`.

Sources: [lib/node/asar-fs-wrapper.ts:185-251](repo://lib/node/asar-fs-wrapper.ts#L185-L251), [lib/node/asar-fs-wrapper.ts:267-287](repo://lib/node/asar-fs-wrapper.ts#L267-L287), [lib/node/asar-fs-wrapper.ts:1230-1239](repo://lib/node/asar-fs-wrapper.ts#L1230-L1239)

`exec` and `execSync` run with asar temporarily disabled, because a command string containing an archive path would otherwise be treated as one path. The `child_process` patches are applied lazily, the first time the module is loaded, unless `ELECTRON_EAGER_ASAR_HOOK_FOR_TESTING` is set.

Sources: [lib/node/asar-fs-wrapper.ts:1218-1279](repo://lib/node/asar-fs-wrapper.ts#L1218-L1279)

### Module loading

`require` inside an archive works because the wrapper also patches Node's internals: `internalBinding('modules').overrideReadFileSync` reads `package.json` files from archives, and `internalModuleStat` reports archive entries as files or directories (or `-ENOENT`), which is what Node's resolver uses.

Sources: [lib/node/asar-fs-wrapper.ts:997-1027](repo://lib/node/asar-fs-wrapper.ts#L997-L1027)

## file: URLs

### Which requests use the asar loader

Pages load `file:` URLs through the network stack, not Node. When the `grant_file_protocol_extra_privileges` fuse is on, the `ProtocolRegistry` replaces the `file` factory with `AsarURLLoaderFactory`; the `net` module uses the same factory for `file:` URLs, and service worker scripts on `file:` URLs are routed to it too ([[Sessions, Protocols and Networking]]).

Sources: [shell/browser/protocol_registry.cc:23-64](repo://shell/browser/protocol_registry.cc#L23-L64), [shell/common/api/electron_api_url_loader.cc:516-520](repo://shell/common/api/electron_api_url_loader.cc#L516-L520), [shell/browser/net/proxying_url_loader_factory.cc:816-825](repo://shell/browser/net/proxying_url_loader_factory.cc#L816-L825)

### AsarURLLoader

`AsarURLLoader` converts the URL to a path. A path outside any archive is handed to Chromium's normal file loader. Inside an archive, a missing entry fails with `ERR_FILE_NOT_FOUND`; an unpacked entry is read from its real path; a packed entry is read from a fresh file handle on the archive (so concurrent requests do not share one) through a mojo data pipe starting at the entry's offset. A single `Range` header is honoured and an unsatisfiable one fails with `ERR_REQUEST_RANGE_NOT_SATISFIABLE`. The MIME type comes from the extension or, failing that, from sniffing the first bytes.

Sources: [shell/browser/net/asar/asar_url_loader.cc:100-200](repo://shell/browser/net/asar/asar_url_loader.cc#L100-L200), [shell/browser/net/asar/asar_url_loader.cc:255-268](repo://shell/browser/net/asar/asar_url_loader.cc#L255-L268)

### Streaming integrity checks

When the entry carries integrity data, the data source is wrapped in an `AsarFileValidator`. It hashes the stream in blocks of `blockSize` bytes, compares each block's SHA-256 with the corresponding entry in `blocks`, and crashes the process on a mismatch. When a range read stops short of a block boundary, the validator reads the rest of the block from its own handle so the block can still be verified.

Sources: [shell/browser/net/asar/asar_url_loader.cc:159-170](repo://shell/browser/net/asar/asar_url_loader.cc#L159-L170), [shell/browser/net/asar/asar_file_validator.cc:20-123](repo://shell/browser/net/asar/asar_file_validator.cc#L20-L123)

## Integrity validation and fuses

### Where the hashes live

Integrity has two levels. Each file entry may carry block hashes in the archive's own header; the header itself is trusted only if its hash matches one embedded in the signed application. On macOS that hash comes from the `ElectronAsarIntegrity` dictionary in the bundle's `Info.plist`, keyed by the archive's path relative to `Contents`. On Windows it comes from an `ElectronAsar` resource of type `Integrity` in the executable. Only `SHA256` is supported, and other platforms have no header integrity source.

Sources: [shell/common/asar/archive_mac.mm:23-64](repo://shell/common/asar/archive_mac.mm#L23-L64), [shell/common/asar/archive_win.cc:25-55](repo://shell/common/asar/archive_win.cc#L25-L55), [shell/common/asar/archive_win.cc:132-140](repo://shell/common/asar/archive_win.cc#L132-L140), [shell/common/asar/archive.cc:269-277](repo://shell/common/asar/archive.cc#L269-L277)

### Failure behaviour

With the `embedded_asar_integrity_validation` fuse on, every failure is fatal rather than an error: a validatable archive with no embedded hash, a header hash mismatch, a file entry without integrity data once the header has been validated, a malformed block list, or a content hash mismatch all end in `LOG(FATAL)`. `ValidateIntegrityOrDie` is the shared check for whole-file reads.

Sources: [shell/common/asar/archive.cc:120-153](repo://shell/common/asar/archive.cc#L120-L153), [shell/common/asar/archive.cc:234-256](repo://shell/common/asar/archive.cc#L234-L256), [shell/common/asar/asar_util.cc:137-149](repo://shell/common/asar/asar_util.cc#L137-L149)

### Related fuses

| Fuse | Default | Effect here |
| --- | --- | --- |
| `embedded_asar_integrity_validation` | off | Enables header and file hash checks (macOS and Windows) |
| `only_load_app_from_asar` | off | Searches only `app.asar` for the app, and requires it to be a valid archive |
| `grant_file_protocol_extra_privileges` | on | Uses the asar loader for `file:` and gives `file:` fetch and service worker support |

Sources: [build/fuses/fuses.json5:1-13](repo://build/fuses/fuses.json5#L1-L13), [shell/common/node_bindings.cc:680-700](repo://shell/common/node_bindings.cc#L680-L700), [lib/browser/init.ts:92-107](repo://lib/browser/init.ts#L92-L107), [shell/renderer/renderer_client_base.cc:282-287](repo://shell/renderer/renderer_client_base.cc#L282-L287)

The defaults come from `build/fuses/fuses.json5`, whose schema says a fuse is never removed or given a new meaning, only marked removed; packagers flip them in the shipped binary, and the generated code that reads them is covered in [[Build System, Patches and JS Bundling]].

Sources: [build/fuses/fuses.json5:1-4](repo://build/fuses/fuses.json5#L1-L4)
