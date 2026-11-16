---
type: concept
title: ASAR archives and application loading
description: Resource discovery, virtual filesystem reads, native extraction and conditional integrity enforcement for packaged Electron applications.
tags: [asar, packaging, filesystem, integrity]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T18:01:04.581Z
sources:
  - id: openwiki-source-7eeed5ef9467bffeed17e70c
    resource: repo://docs/tutorial/asar-archives.md
  - id: openwiki-source-85151ea4a0ecb0d852396c8e
    resource: repo://lib/browser/init.ts
  - id: openwiki-source-fc70a27ce2ad9ad66fb961ef
    resource: repo://lib/node/asar-fs-wrapper.ts
  - id: openwiki-source-0b7fa519832032182e66e802
    resource: repo://lib/node/init.ts
  - id: openwiki-source-66346ccfb1f08a297f3d8f6e
    resource: repo://shell/browser/net/asar/asar_url_loader.cc
  - id: openwiki-source-a80d965312b6d4ace23f3bad
    resource: repo://shell/common/asar/archive.cc
  - id: openwiki-source-7a563f98407b944e8311fdf4
    resource: repo://shell/common/node_bindings.cc
generated: { by: "codex", at: "2026-11-16T18:01:04.581Z" }
---

# ASAR archives and application loading

ASAR is an application resource archive that Electron exposes through filesystem and URL-loading adaptations. An archive path can look like a directory to JavaScript, but it remains a physical archive file with a header describing entries, offsets, links and unpacked resources. Keep mutable application data outside the archive.

## Selecting the application

Native Node initialization supplies the browser bootstrap with resource candidates in order: `app.asar`, `app`, `default_app.asar`. The only-load-app-from-ASAR fuse restricts discovery to `app.asar`. `lib/browser/init.ts` reads each candidate's package metadata, sets application identity and loads its `main` entry, defaulting to `index.js`. An invalid candidate is skipped; no valid package results in an error and exit code 1. ESM/CommonJS selection is detailed in [runtime startup](../architecture/runtime-startup.md).

Node initialization also filters module search paths when the requesting module lies under `process.resourcesPath`, preventing ordinary ancestor searches from escaping that resource tree. This is a resolution rule; it does not make application code a sandbox.

## Virtual filesystem mechanism

`lib/node/init.ts` wraps Node's `fs` with `wrapFsWithAsar`. The wrapper normalizes a candidate path and asks the native ASAR binding to split the archive location from the internal filename. Nonarchive paths fall through to the original implementation. Native archive objects are cached by archive path.

For a packed `readFileSync`, the wrapper retrieves entry metadata, reads the specified bytes from the archive descriptor, validates integrity when supplied, then returns a buffer or decoded string. An unpacked entry delegates to the real filesystem path. Native `Archive::Init` reads the size/header, parses the JSON directory tree, and rejects malformed headers. Missing entries and invalid archives produce distinct filesystem-facing errors.

Browser URL reads have a separate native path in `shell/browser/net/asar/asar_url_loader.cc`, which resolves archive entries and can attach an ASAR file validator to streamed data. A successful Node filesystem test therefore does not by itself validate browser resource loading; both paths matter for packaged pages.

## Real-file operations and limitations

Some consumers require a real OS path. The wrapper adapts `fs.open`, native-module loading through `process.dlopen`/`.node`, and `execFile` variants with `copyFileOut`. Native `Archive::CopyFileOut` returns `<archive>.unpacked/<entry>` for unpacked entries; packed entries are extracted into cached temporary files, preserving executable permissions on POSIX when indicated.

| Requirement | Consequence |
| --- | --- |
| Read application assets | Ordinary archive-aware `fs` reads can access packed bytes directly |
| Load a native module or hand a path to an OS consumer | Requires a real file; extraction or an unpacked companion supplies it |
| Write persistent state | Archives are read-only; choose an actual external directory |
| Set `cwd` | An archive-internal directory is virtual and cannot be a working directory |
| Interpret `stat` metadata | Size/type are useful; times, inode and other fields are synthesized |

Use `original-fs` to access the archive as an ordinary file. `process.noAsar` disables wrapper detection. `ELECTRON_NO_ASAR` is honored by this wrapper only outside browser and renderer process types, so it is not a universal application switch.

## Integrity is conditional

Archive packaging alone does not imply integrity enforcement. In this checkout, native embedded-header validation is compiled for macOS and Windows, requires the embedded-ASAR-integrity fuse, and applies when the archive has a validatable relative path. It compares the archive header with embedded integrity metadata and treats missing or invalid required metadata as fatal. File-integrity metadata is loaded when the header was validated and the fuse is enabled.

JavaScript buffer reads hash bytes when entry integrity metadata is present; a mismatch logs an integrity violation and exits with code 1. Native extraction and URL-loading paths also consume integrity information. Unpacked entries return their external path early, so do not assume that packing configuration automatically protects every companion file. The ASAR-only lookup fuse and integrity-validation fuse address different parts of application loading.

## Tests and investigation

`spec/asar-spec.ts` covers synchronous/asynchronous/promise filesystem APIs, links, unpacked files, native operations, bypass flags, browser protocol access and workers. `spec/asar-integrity-spec.ts` copies applications, flips fuses and checks corrupted content/header outcomes. When debugging a packaged-only failure, identify which path is involved: package discovery, virtual fs, real-file extraction or browser URL loading.

See [distribution and release](../operations/distribution-and-release.md) for framework binaries and npm installation, and [sessions and networking](sessions-and-networking.md) for custom protocol routing.
