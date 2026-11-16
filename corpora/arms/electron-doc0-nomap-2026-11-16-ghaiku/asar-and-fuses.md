---
title: "ASAR Archives and Fuses"
---
## Overview

Electron apps can ship their code in `.asar` archives, which are single files that the runtime reads as a folder tree. This page covers the two places that make that work: the JavaScript wrapper that routes `fs` calls for archive paths to the native archive reader, and the fuses, which are bits compiled into the binary that turn features on or off. Packing archives for a release is on [[Release and Publishing]].

Sources: [lib/node/asar-fs-wrapper.ts:1-30](repo://lib/node/asar-fs-wrapper.ts#L1-L30)

## Routing fs calls

`wrapFsWithAsar` replaces the `fs` functions with versions that check each path. The check is `splitPath`: it returns "not an archive" straight away when ASAR is disabled, and otherwise it accepts only strings, buffers and URLs whose path matches `.asar` case-insensitively. Only a matching path goes to the native splitter that separates the archive file from the path inside it.

Sources: [lib/node/asar-fs-wrapper.ts:73-88](repo://lib/node/asar-fs-wrapper.ts#L73-L88), [lib/node/asar-fs-wrapper.ts:49](repo://lib/node/asar-fs-wrapper.ts#L49)

ASAR is disabled in two cases. `process.noAsar` turns it off for the process, and the `ELECTRON_NO_ASAR` environment variable does the same, but only in processes that are neither the browser nor a renderer. The variable has no effect in the browser or a renderer.

Sources: [lib/node/asar-fs-wrapper.ts:15-18](repo://lib/node/asar-fs-wrapper.ts#L15-L18)

Archives are opened once and cached by path. `getOrCreateArchive` returns the cached archive or opens a new one, and it returns `null` when the file is not a valid archive, which tells callers to fall back to the real file system. The native loader publishes this function as `process._getOrCreateArchive` so that the browser init script can check the package path before it loads `package.json`.

Sources: [lib/node/asar-fs-wrapper.ts:29-47](repo://lib/node/asar-fs-wrapper.ts#L29-L47), [lib/browser/init.ts:86-101](repo://lib/browser/init.ts#L86-L101)

Two helpers do the actual replacement. `overrideAPISync` wraps a synchronous `fs` function so that archive paths are answered from the archive, and `overrideAPI` does the same for the callback form. Each wrapper takes the index of the path argument, so one table can cover functions with different signatures.

Sources: [lib/node/asar-fs-wrapper.ts:185-215](repo://lib/node/asar-fs-wrapper.ts#L185-L215)

Setting `ELECTRON_LOG_ASAR_READS` writes one line per archive read, with the byte offset and the file path, to an `<archive>-access-log.txt` file in the temp folder. The log is for finding which files an app reads and in what order.

Sources: [lib/node/asar-fs-wrapper.ts:290-300](repo://lib/node/asar-fs-wrapper.ts#L290-L300)

## Fuses

A fuse is a one-character flag in a byte array, `kFuseWire`, that the build embeds in the binary. The array starts with a sentinel, a version byte and a length, so a tool can find it and change the values after the build. The defaults are listed in `build/fuses/fuses.json5`, one flag per line, with `"1"` for on and `"0"` for off.

Sources: [build/fuses/fuses.json5:1-13](repo://build/fuses/fuses.json5#L1-L13), [build/fuses/build.py:44](repo://build/fuses/build.py#L44)

The fuse file's own comment forbids removing a fuse or changing its meaning. A retired fuse is marked `r` in the schema and keeps its place, so binaries built from older defaults still read the right byte.

Sources: [build/fuses/fuses.json5:2-4](repo://build/fuses/fuses.json5#L2-L4)

`build.py` generates one getter per fuse. The getter's name is the fuse's snake-case name in title case, prefixed with `Is` and suffixed with `Enabled`. In a debug build (`DCHECK_IS_ON`) the getter first reads a `--set-fuse-<name>` command-line switch, so a debug binary can flip a fuse without rebuilding. Release builds read the byte alone.

Sources: [build/fuses/build.py:67-88](repo://build/fuses/build.py#L67-L88)

The fuses that change archive loading are read in the native startup code, which runs in the order given on [[Process Startup]]. `ValidateV8Snapshot` checks the V8 startup snapshot only when the embedded ASAR integrity validation fuse is on, and the Node bindings set `appSearchPathsOnlyLoadASAR` from the only-load-from-ASAR fuse, which the JavaScript browser init script reads when it looks for `package.json`.

Sources: [shell/app/electron_main_delegate.cc:216-220](repo://shell/app/electron_main_delegate.cc#L216-L220), [shell/common/node_bindings.cc:686-699](repo://shell/common/node_bindings.cc#L686-L699)

Other fuses are read where their feature lives. `RunAsNode` decides at the top of `main` whether the binary acts as Node.js, the cookie encryption fuse decides how network cookies are stored, and the grant-file-protocol fuse decides whether `file:` pages get extra privileges.

Sources: [shell/app/electron_main_linux.cc:36](repo://shell/app/electron_main_linux.cc#L36), [shell/browser/net/network_context_service.cc:113-116](repo://shell/browser/net/network_context_service.cc#L113-L116), [shell/browser/protocol_registry.cc:24-28](repo://shell/browser/protocol_registry.cc#L24-L28)
