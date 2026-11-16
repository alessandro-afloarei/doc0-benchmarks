---
title: "Fuses"
---
## Overview

Fuses are on/off switches compiled into the Electron binary as a fixed byte array, the *fuse wire*, that an app's packaging step can flip without rebuilding Electron. The user tutorial explains the motivation: most apps never use features such as `ELECTRON_RUN_AS_NODE`, and want to ship a binary that cannot use them. Because the bytes are flipped before code signing, the operating system's signature checks keep them from being flipped back.

Sources: [docs/tutorial/fuses.md:1-9](repo://docs/tutorial/fuses.md#L1-L9)

This page covers how the wire is generated at build time, how the code reads it, and where each fuse takes effect. The pages linked from the table describe the features the fuses guard.

Sources: [build/fuses/build.py:62-111](repo://build/fuses/build.py#L62-L111)

## The schema

`build/fuses/fuses.json5` lists the fuses in order, each with its default: `"1"` on, `"0"` off, or `"r"` for a removed fuse. Its comment sets the compatibility rule: a breaking schema change must increment `_version`, and a fuse is never removed or redefined, only marked `r`. Order matters, because a fuse's position in the file is its position in the wire.

Sources: [build/fuses/fuses.json5:1-13](repo://build/fuses/fuses.json5#L1-L13)

| Fuse | Default | Getter |
| --- | --- | --- |
| `run_as_node` | on | `IsRunAsNodeEnabled` |
| `cookie_encryption` | off | `IsCookieEncryptionEnabled` |
| `node_options` | on | `IsNodeOptionsEnabled` |
| `node_cli_inspect` | on | `IsNodeCliInspectEnabled` |
| `embedded_asar_integrity_validation` | off | `IsEmbeddedAsarIntegrityValidationEnabled` |
| `only_load_app_from_asar` | off | `IsOnlyLoadAppFromAsarEnabled` |
| `load_browser_process_specific_v8_snapshot` | off | `IsLoadBrowserProcessSpecificV8SnapshotEnabled` |
| `grant_file_protocol_extra_privileges` | on | `IsGrantFileProtocolExtraPrivilegesEnabled` |

Sources: [build/fuses/fuses.json5:5-12](repo://build/fuses/fuses.json5#L5-L12), [build/fuses/build.py:68-72](repo://build/fuses/build.py#L68-L72)

## Generating the wire

The GN action `electron_fuses` runs `build/fuses/build.py` with `fuses.json5` as input and writes `fuses.h` and `fuses.cc` into the generated sources, which are compiled into the Electron binary.

Sources: [BUILD.gn:393-401](repo://BUILD.gn#L393-L401), [BUILD.gn:774-774](repo://BUILD.gn#L774-L774)

The script strips comment lines and loads the JSON with key order preserved. It removes `_version`, `_schema` and `_comment`, and refuses a version that does not fit in one byte. It then emits one array.

Sources: [build/fuses/build.py:51-60](repo://build/fuses/build.py#L51-L60)

```text
const volatile char kFuseWire[] = { sentinel (32 bytes), fuse_version, fuse_wire_length, fuse_wire... };
```

Sources: [build/fuses/build.py:44-60](repo://build/fuses/build.py#L44-L60), [build/fuses/build.py:100-111](repo://build/fuses/build.py#L100-L111)

The sentinel is the fixed 32-character string `dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX`. Each wire byte is the ASCII `'0'`, `'1'` or `'r'` from the schema. The array is `volatile`, so the compiler must read it at run time instead of folding the default values into the getters. The tutorial documents the layout for tools that edit the binary: find the sentinel, read the version and length bytes, and change a fuse's byte to `0` or `1`.

Sources: [build/fuses/build.py:10-10](repo://build/fuses/build.py#L10-L10), [build/fuses/build.py:13-31](repo://build/fuses/build.py#L13-L31), [docs/tutorial/fuses.md:115-139](repo://docs/tutorial/fuses.md#L115-L139)

## Reading a fuse

Each fuse gets an exported getter, `Is<Name>Enabled()`, named by title-casing the schema key. The getter returns `kFuseWire[index] == '1'`, where the index counts past the sentinel, the version byte and the length byte. A removed fuse (`r`) therefore always reads as off.

Sources: [build/fuses/build.py:64-88](repo://build/fuses/build.py#L64-L88)

In DCHECK builds, a command-line switch `--set-fuse-<name>=1` (or any other value, for off) overrides the wire, so tests can exercise both states without editing the binary. The check is guarded by `base::CommandLine::InitializedForCurrentProcess()`, because, as the generated comment explains, `run_as_node` is read before the command line exists.

Sources: [build/fuses/build.py:73-88](repo://build/fuses/build.py#L73-L88)

## Where each fuse applies

### Checks by fuse

| Fuse | Checked in | Effect when off (or on, for default-off fuses) |
| --- | --- | --- |
| `run_as_node` | Every platform `main`, `IsRunningAsNode` for crash keys | Off: `ELECTRON_RUN_AS_NODE` is ignored and the binary always starts Chromium; see [[Process Startup]] |
| `node_options` | `NodeMain`, `SetNodeOptions`, `NodeBindings::Initialize` | Off: `NODE_OPTIONS` and `NODE_EXTRA_CA_CERTS` are removed, and Node is told to ignore `NODE_OPTIONS` |
| `node_cli_inspect` | `IsAllowedOption`, `CreateEnvironment` | Off: `--inspect` and the other debug flags are dropped, and Node does not listen for `SIGUSR1` |
| `only_load_app_from_asar` | `CreateEnvironment` | On: the app search paths are only `app.asar`, and each candidate must open as an archive |
| `embedded_asar_integrity_validation` | `asar::Archive`, `ValidateV8Snapshot` (macOS and Windows) | On: archive headers and file contents inside the bundle are checked against their hashes, and the V8 snapshot is validated; see [[ASAR Archives]] |
| `cookie_encryption` | `NetworkContextService`, `SystemNetworkContextManager` | On: persistent sessions encrypt cookies on disk, and the key is sent to an out-of-process network service; see [[Sessions and Browser Contexts]] |
| `load_browser_process_specific_v8_snapshot` | `GetBrowserV8SnapshotFilename` | On: the browser process loads `browser_v8_context_snapshot.bin` |
| `grant_file_protocol_extra_privileges` | `ElectronContentClient`, `RendererClientBase`, `ElectronBrowserClient`, `ProtocolRegistry` | Off: `file:` loses service worker and fetch support, universal and file-to-file access, and the ASAR-aware loader |

Sources: [shell/app/electron_main_linux.cc:36-40](repo://shell/app/electron_main_linux.cc#L36-L40), [shell/app/electron_main_mac.cc:51-56](repo://shell/app/electron_main_mac.cc#L51-L56), [shell/app/electron_main_win.cc:160-161](repo://shell/app/electron_main_win.cc#L160-L161), [shell/common/crash_keys.cc:95-98](repo://shell/common/crash_keys.cc#L95-L98), [shell/app/node_main.cc:126-131](repo://shell/app/node_main.cc#L126-L131), [shell/common/node_bindings.cc:385-388](repo://shell/common/node_bindings.cc#L385-L388), [shell/common/node_bindings.cc:408-455](repo://shell/common/node_bindings.cc#L408-L455), [shell/common/node_bindings.cc:625-626](repo://shell/common/node_bindings.cc#L625-L626), [shell/common/node_bindings.cc:681-700](repo://shell/common/node_bindings.cc#L681-L700), [shell/common/node_bindings.cc:730-734](repo://shell/common/node_bindings.cc#L730-L734), [shell/common/asar/archive.cc:120-122](repo://shell/common/asar/archive.cc#L120-L122), [shell/common/asar/archive.cc:234-237](repo://shell/common/asar/archive.cc#L234-L237), [shell/app/electron_main_delegate.cc:216-219](repo://shell/app/electron_main_delegate.cc#L216-L219), [shell/browser/net/network_context_service.cc:114-115](repo://shell/browser/net/network_context_service.cc#L114-L115), [shell/browser/net/system_network_context_manager.cc:277-282](repo://shell/browser/net/system_network_context_manager.cc#L277-L282), [shell/app/electron_main_delegate.cc:436-444](repo://shell/app/electron_main_delegate.cc#L436-L444), [shell/app/electron_content_client.cc:150-152](repo://shell/app/electron_content_client.cc#L150-L152), [shell/renderer/renderer_client_base.cc:284-287](repo://shell/renderer/renderer_client_base.cc#L284-L287), [shell/browser/electron_browser_client.cc:415-418](repo://shell/browser/electron_browser_client.cc#L415-L418), [shell/browser/protocol_registry.cc:26-55](repo://shell/browser/protocol_registry.cc#L26-L55)

### run_as_node in more detail

`run_as_node` is the earliest fuse read. Each platform `main` checks it before Chromium starts, so with the fuse off the environment variable has no effect at all. `ElectronInitializeICUandStartNode`, the macOS library entry, treats a call with the fuse off as unreachable. Turning the fuse off also breaks `child_process.fork` from the main process, which works by setting `ELECTRON_RUN_AS_NODE` for the child, as [[Internal JavaScript Bundles]] shows; the tutorial points apps to `utilityProcess` instead, described in [[Utility Process]].

Sources: [shell/app/electron_main_linux.cc:36-40](repo://shell/app/electron_main_linux.cc#L36-L40), [shell/app/electron_library_main.mm:39-42](repo://shell/app/electron_library_main.mm#L39-L42), [lib/node/init.ts:15-38](repo://lib/node/init.ts#L15-L38), [docs/tutorial/fuses.md:13-19](repo://docs/tutorial/fuses.md#L13-L19)

### node_options and packaged apps

`node_options` is one of two layers over `NODE_OPTIONS`. Even with the fuse on, `SetNodeOptions` keeps only `--http-parser` and `--max-http-header-size` in a packaged app, and always drops options that conflict with BoringSSL. The fuse decides whether the variable is read at all. In run-as-Node mode, `NodeMain` unsets the variables when the fuse is off; on macOS it also unsets injectable variables when the parent process is not signed like the app, as [[Process Startup]] describes.

Sources: [shell/common/node_bindings.cc:397-456](repo://shell/common/node_bindings.cc#L397-L456), [shell/app/node_main.cc:123-151](repo://shell/app/node_main.cc#L123-L151)
