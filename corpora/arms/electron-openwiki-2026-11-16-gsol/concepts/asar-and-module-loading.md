---
type: concept
title: ASAR and module loading
description: How Electron adapts Node filesystem and module loading for ASAR archives, including extraction, lookup boundaries, and failure cases.
tags: [asar, filesystem, modules, packaging]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T07:11:18.304Z
sources:
  - id: openwiki-source-fc70a27ce2ad9ad66fb961ef
    resource: repo://lib/node/asar-fs-wrapper.ts
  - id: openwiki-source-0b7fa519832032182e66e802
    resource: repo://lib/node/init.ts
  - id: openwiki-source-a80d965312b6d4ace23f3bad
    resource: repo://shell/common/asar/archive.cc
generated: { by: "codex", at: "2026-11-16T07:11:18.304Z" }
---

# ASAR and module loading

ASAR makes a packaged application's archive appear directory-like to selected Electron filesystem and module APIs. It is an adaptation layer inside the runtime: the operating system does not mount the archive as a filesystem.

## Initialization and path routing

`lib/node/init.ts` wraps Node's `fs` module before subsequent initialization. The wrapper splits candidate paths into archive and member paths, caches native Archive instances by archive path, and delegates ordinary paths to the original APIs. Failed archive construction returns null so callers can report an invalid archive.

`process.noAsar` bypasses archive handling. `ELECTRON_NO_ASAR` is captured at initialization and only disables this handling outside browser and renderer process types. Use [the ASAR guide](../../docs/tutorial/asar-archives.md) for `original-fs`, the unwrapped alternative when operating on archive bytes themselves.

## Reading and extracting members

For packed files, the readFile adapters obtain member size and offset, read from the archive descriptor, and validate available integrity metadata before returning data. Empty members return an empty buffer or string. Unpacked members are routed to their real sibling paths. Missing archives and members produce distinct wrapper errors, with callback failures scheduled on the next tick where implemented.

APIs requiring real paths use `copyFileOut`. Native `Archive::CopyFileOut` returns an existing extracted file from its cache, returns an `.asar.unpacked` path for an unpacked member, or creates a scoped temporary file from the packed member. POSIX executable members receive executable permissions.

This extraction route is used for `fs.open`, `process.dlopen`, native `.node` modules, and `child_process.execFile`. A native addon can therefore incur extraction even when a JavaScript read would use the archive descriptor. Arbitrary shell command strings do not receive equivalent archive-path interpretation: `exec` and `execSync` temporarily disable ASAR routing around their original implementation.

## Application and module resolution

Main-process bootstrap discovers application packages under `process.resourcesPath`; archive support lets the package manifest and startup module be read from `app.asar`. The ASAR-only fuse also changes application search policy. See [runtime bootstrap](../architecture/runtime-and-bootstrap.md) for package selection and ESM/CommonJS dispatch.

Node initialization additionally filters `Module._nodeModulePaths`: when resolution starts inside the resources directory, generated lookup paths outside that directory are removed. Resolution originating outside resources keeps Node's normal path list. This is a lookup boundary, not a replacement for renderer sandboxing or a general filesystem permission system.

The same initializer adapts `child_process.fork` to launch Electron with `ELECTRON_RUN_AS_NODE=1`, using the helper executable on macOS unless an explicit executable is supplied. Distribution fuse choices can consequently affect child-process behavior.

## Limits and verification

Treat archives as read-only packaged resources and place mutable state in application data directories. The existing ASAR guide explains working-directory restrictions, synthetic stat information, and unpacking options. Integrity behavior depends on archive metadata and runtime fuse/platform support; archive packaging alone is not proof of validation.

`spec/asar-spec.ts` groups tests by filesystem operation, with callback, synchronous, and promise variants, plus worker and protocol cases. When changing an adapter, inspect the matching ordinary-path fallback and all supported variants. Use [runtime testing](../testing/runtime-and-api-tests.md) for the harness and [distribution](../operations/distribution-and-release.md) for binary installation and fuses.
