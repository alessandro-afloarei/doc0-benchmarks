---
title: "Fuses"
---
## Overview

Fuses are on/off switches for security-sensitive features, stored as bytes inside the Electron executable rather than read from configuration, the command line or the environment. Because the values sit in the binary behind a known sentinel, they can be changed in a built executable to remove capabilities an app never needs, such as running as plain Node.js; nothing an environment variable or command-line argument does can turn them back on in a release build. This page covers how the fuse wire is generated, what each fuse controls, and where the C++ code checks it. The asar mechanics two fuses protect are in [[ASAR Archives]].

Sources: [build/fuses/fuses.json5:1-13](repo://build/fuses/fuses.json5#L1-L13), [build/fuses/build.py:10-111](repo://build/fuses/build.py#L10-L111)

## The fuse wire

### Definition

`build/fuses/fuses.json5` lists every fuse with its default: `"1"` for on, `"0"` for off, `"r"` for a removed fuse. Its comment sets the compatibility rules: a fuse is never removed or repurposed, only marked `r`, and any breaking change to the schema increments `_version`.

Sources: [build/fuses/fuses.json5:1-13](repo://build/fuses/fuses.json5#L1-L13)

### Generation

The `electron_fuses` GN action runs `build/fuses/build.py`, which writes `fuses.h` and `fuses.cc` into the generated sources. The `.cc` file defines `kFuseWire`, a `volatile` char array laid out as:

Sources: [BUILD.gn:393-404](repo://BUILD.gn#L393-L404), [build/fuses/build.py:33-49](repo://build/fuses/build.py#L33-L49)

| Bytes | Content |
| --- | --- |
| 32 | The sentinel string `dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX` |
| 1 | The fuse schema version |
| 1 | The number of fuses |
| N | One ASCII `'0'`, `'1'` or `'r'` per fuse, in file order |

Sources: [build/fuses/build.py:10-10](repo://build/fuses/build.py#L10-L10), [build/fuses/build.py:44-44](repo://build/fuses/build.py#L44-L44), [build/fuses/build.py:100-105](repo://build/fuses/build.py#L100-L105)

The sentinel lets external tooling find the wire in a compiled binary and overwrite the fuse bytes in place; `volatile` stops the compiler from folding the values into the code. The version must fit in one byte.

Sources: [build/fuses/build.py:24-24](repo://build/fuses/build.py#L24-L24), [build/fuses/build.py:59-60](repo://build/fuses/build.py#L59-L60)

### Accessors

For each fuse the script emits an exported `Is<Name>Enabled()` function, the name being the fuse's snake-case key in title case, that returns whether its byte is `'1'`. In DCHECK (debug) builds a `--set-fuse-<name>=1|0` switch overrides the byte, so tests can exercise both states without patching the binary; the check is skipped when the command line is not yet initialised, because `RunAsNode` is read that early.

Sources: [build/fuses/build.py:62-88](repo://build/fuses/build.py#L62-L88)

## The fuses

### Summary

| Fuse | Default | What turning it off (or on) does |
| --- | --- | --- |
| `run_as_node` | on | Off: `ELECTRON_RUN_AS_NODE` is ignored |
| `cookie_encryption` | off | On: cookies on disk are encrypted with the OS key store |
| `node_options` | on | Off: `NODE_OPTIONS` and `NODE_EXTRA_CA_CERTS` are ignored |
| `node_cli_inspect` | on | Off: `--inspect` and related flags are ignored, no `SIGUSR1` debugger |
| `embedded_asar_integrity_validation` | off | On: `app.asar` must match hashes embedded in the executable (macOS, Windows) |
| `only_load_app_from_asar` | off | On: the app is only loaded from `app.asar` |
| `load_browser_process_specific_v8_snapshot` | off | On: the main process uses `browser_v8_context_snapshot.bin` |
| `grant_file_protocol_extra_privileges` | on | Off: `file:` loses the extra privileges Electron grants it |

Sources: [build/fuses/fuses.json5:5-12](repo://build/fuses/fuses.json5#L5-L12)

### RunAsNode

The platform `main` functions check `IsRunAsNodeEnabled()` before honouring `ELECTRON_RUN_AS_NODE`, and the macOS library entry point refuses to start Node when it is off. Crash keys use the same test to label a process as Node. `lib/node/init.ts` sets `ELECTRON_RUN_AS_NODE` for `child_process.fork`, so with this fuse off forking a script no longer produces a Node child. [[Process Model and Native Startup]] shows where this sits in startup.

Sources: [shell/app/electron_main_linux.cc:36-40](repo://shell/app/electron_main_linux.cc#L36-L40), [shell/app/electron_main_win.cc:160-170](repo://shell/app/electron_main_win.cc#L160-L170), [shell/app/electron_library_main.mm:39-42](repo://shell/app/electron_library_main.mm#L39-L42), [shell/common/crash_keys.cc:95-99](repo://shell/common/crash_keys.cc#L95-L99), [lib/node/init.ts:31-35](repo://lib/node/init.ts#L31-L35)

### CookieEncryption

Each persistent session's network context sets `enable_encrypted_cookies` from this fuse, and when the network service runs out of process the system context manager sends it the OS encryption key only if the fuse is on. See [[The net Module]].

Sources: [shell/browser/net/network_context_service.cc:112-116](repo://shell/browser/net/network_context_service.cc#L112-L116), [shell/browser/net/system_network_context_manager.cc:276-283](repo://shell/browser/net/system_network_context_manager.cc#L276-L283)

### NodeOptions

In Node mode, `NodeMain` unsets `NODE_OPTIONS` and `NODE_EXTRA_CA_CERTS` when the fuse is off. In Electron's own processes, `SetNodeOptions` logs and drops the variables, and Node is initialised with `kDisableNodeOptionsEnv`.

Sources: [shell/app/node_main.cc:126-131](repo://shell/app/node_main.cc#L126-L131), [shell/common/node_bindings.cc:397-455](repo://shell/common/node_bindings.cc#L397-L455), [shell/common/node_bindings.cc:625-626](repo://shell/common/node_bindings.cc#L625-L626)

### NodeCliInspect

`IsAllowedOption` only lets `--inspect`, `--inspect-brk`, `--inspect-port` and the other debug flags through to Node when the fuse is on, and with it off the Node environment is created with `kNoStartDebugSignalHandler` so `SIGUSR1` cannot start the inspector either.

Sources: [shell/common/node_bindings.cc:355-395](repo://shell/common/node_bindings.cc#L355-L395), [shell/common/node_bindings.cc:728-732](repo://shell/common/node_bindings.cc#L728-L732)

### EmbeddedAsarIntegrityValidation

On macOS and Windows, this makes `asar::Archive` verify the header of any archive inside the app's resources against the hash in `Info.plist` or the executable's resources, and require per-file integrity data; any failure is fatal. It also makes `ValidateV8Snapshot` check the V8 startup snapshot against a checksum compiled into the binary.

Sources: [shell/common/asar/archive.cc:119-155](repo://shell/common/asar/archive.cc#L119-L155), [shell/common/asar/archive.cc:233-260](repo://shell/common/asar/archive.cc#L233-L260), [shell/app/electron_main_delegate.cc:215-225](repo://shell/app/electron_main_delegate.cc#L215-L225)

### OnlyLoadAppFromAsar

When on, `NodeBindings::CreateEnvironment` gives the main-process bootstrap only `app.asar` as a search path (instead of `app.asar`, `app`, `default_app.asar`) and sets `appSearchPathsOnlyLoadASAR`, so `lib/browser/init.ts` skips any candidate that does not open as an archive. Combined with integrity validation, this ensures the code that runs is the code that was signed. See [[Main Process Bootstrap]].

Sources: [shell/common/node_bindings.cc:675-698](repo://shell/common/node_bindings.cc#L675-L698), [lib/browser/init.ts:92-107](repo://lib/browser/init.ts#L92-L107)

### LoadBrowserProcessSpecificV8Snapshot

When on, `ElectronMainDelegate::GetBrowserV8SnapshotFilename` makes the main process load `browser_v8_context_snapshot.bin` instead of the snapshot shared with renderers, so an app can ship a custom snapshot for its main process.

Sources: [shell/app/electron_main_delegate.cc:436-444](repo://shell/app/electron_main_delegate.cc#L436-L444)

### GrantFileProtocolExtraPrivileges

On by default, this keeps `file:` behaving as Electron apps have historically relied on: `file:` pages may read other `file:` URLs and have universal access from file URLs, `file:` supports service workers and `fetch`, and `file:` requests go through the asar-aware loader. Turning it off leaves `file:` with Chromium's normal, more restrictive rules.

Sources: [shell/browser/electron_browser_client.cc:410-419](repo://shell/browser/electron_browser_client.cc#L410-L419), [shell/app/electron_content_client.cc:150-152](repo://shell/app/electron_content_client.cc#L150-L152), [shell/renderer/renderer_client_base.cc:282-288](repo://shell/renderer/renderer_client_base.cc#L282-L288), [shell/browser/protocol_registry.cc:23-64](repo://shell/browser/protocol_registry.cc#L23-L64)
