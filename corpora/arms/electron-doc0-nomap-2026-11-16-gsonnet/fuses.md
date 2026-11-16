---
title: "Fuses and Binary-Level Feature Switches"
---
## Overview

A fuse is a feature switch stored in the Electron executable itself, not in app code or configuration. The defaults live in `build/fuses/fuses.json5`; the build turns them into a byte array inside the binary and a set of C++ getters. Because the bytes are in the binary, a packaging tool can flip a fuse after the build without recompiling, and the app cannot undo the choice at runtime. This page covers how fuses are defined, how the getters read them, and what each fuse changes in the code. The behaviour each one gates is also described where it applies: [[Utility Processes and Run-as-Node]], [[Process Startup and Main Process Boot]] and [[Sessions, Custom Protocols and Network Interception]].

Sources: [build/fuses/fuses.json5:1-13](repo://build/fuses/fuses.json5#L1-L13), [build/fuses/build.py:59-88](repo://build/fuses/build.py#L59-L88)

## Defining fuses

`fuses.json5` is a flat map from fuse name to a one-character state: `0` is off, `1` is on and `r` marks a removed fuse. Its comment states the compatibility rule: a breaking change to the schema must increment `_version`, and a fuse is never removed or redefined; it is marked `r` instead.

Sources: [build/fuses/fuses.json5:1-4](repo://build/fuses/fuses.json5#L1-L4)

```json
{
  "_version": 1,
  "run_as_node": "1",
  "cookie_encryption": "0",
  "node_options": "1",
  "node_cli_inspect": "1",
  "embedded_asar_integrity_validation": "0",
  "only_load_app_from_asar": "0",
  "load_browser_process_specific_v8_snapshot": "0",
  "grant_file_protocol_extra_privileges": "1"
}
```

Sources: [build/fuses/fuses.json5:1-13](repo://build/fuses/fuses.json5#L1-L13)

## Generated code

`build/fuses/build.py` reads the file, drops the metadata keys, refuses a version of 256 or more (it must fit in one byte), and generates `fuses.h` and `fuses.cc`. The GN target `electron_fuses` runs it and is a dependency of the main Electron library.

Sources: [build/fuses/build.py:44-62](repo://build/fuses/build.py#L44-L62), [BUILD.gn:393-404](repo://BUILD.gn#L393-L404), [BUILD.gn:434-436](repo://BUILD.gn#L434-L436)

For each fuse it appends the default character to the wire and emits an exported getter named from the fuse: `run_as_node` becomes `IsRunAsNodeEnabled()`. The wire is `kFuseWire`, a `volatile` byte array holding a sentinel string, the schema version, the number of fuses, and then one character per fuse. A packaging tool can locate the sentinel in the executable and rewrite the characters.

Sources: [build/fuses/build.py:14-48](repo://build/fuses/build.py#L14-L48), [build/fuses/build.py:62-111](repo://build/fuses/build.py#L62-L111)

```python
  return kFuseWire[{index}] == '1';
```

Sources: [build/fuses/build.py:86-86](repo://build/fuses/build.py#L86-L86)

In builds where DCHECKs are on, each getter first looks for a `--set-fuse-<name>` command-line switch and returns whether its value is `"1"`. The comment explains the guard: `RunAsNode` is queried so early that `base::CommandLine` may not be initialised, so the check is skipped until it is. This lets tests toggle fuses without rewriting the binary.

Sources: [build/fuses/build.py:73-88](repo://build/fuses/build.py#L73-L88)

## Fuse catalogue

### Defaults at a glance

| Fuse | Default | What the code does with it |
| --- | --- | --- |
| `run_as_node` | on | `main()` runs `NodeMain` when `ELECTRON_RUN_AS_NODE` is set; crash keys also read it |
| `cookie_encryption` | off | Enables encrypted cookies in network contexts |
| `node_options` | on | Allows `NODE_OPTIONS` and `NODE_EXTRA_CA_CERTS` |
| `node_cli_inspect` | on | Allows debug CLI options such as `--inspect` |
| `embedded_asar_integrity_validation` | off | Validates ASAR header integrity and the V8 snapshot checksum |
| `only_load_app_from_asar` | off | Restricts the app search path to `app.asar` |
| `load_browser_process_specific_v8_snapshot` | off | Loads a dedicated snapshot in the browser process |
| `grant_file_protocol_extra_privileges` | on | Gives `file://` pages extra privileges |

Sources: [build/fuses/fuses.json5:5-12](repo://build/fuses/fuses.json5#L5-L12)

### run_as_node

`main()` on each platform checks `IsRunAsNodeEnabled()` together with the environment variable before it touches Chromium, and the macOS library entry point asserts it is on. The crash-key code uses the same pair to tell whether the process is running as Node.

Sources: [shell/app/electron_main_linux.cc:36-42](repo://shell/app/electron_main_linux.cc#L36-L42), [shell/app/electron_library_main.mm:39-42](repo://shell/app/electron_library_main.mm#L39-L42), [shell/common/crash_keys.cc:96-100](repo://shell/common/crash_keys.cc#L96-L100)

### node_options and node_cli_inspect

With `node_options` off, `NodeMain` unsets `NODE_OPTIONS` and `NODE_EXTRA_CA_CERTS`, and `SetNodeOptions` in the embedded runtime does the same, logging that `NODE_OPTIONS` was ignored. `NodeBindings::Initialize` also passes `kDisableNodeOptionsEnv` to Node. When it is on, `SetNodeOptions` filters the options through allow and block lists.

Sources: [shell/app/node_main.cc:126-131](repo://shell/app/node_main.cc#L126-L131), [shell/common/node_bindings.cc:405-425](repo://shell/common/node_bindings.cc#L405-L425), [shell/common/node_bindings.cc:624-627](repo://shell/common/node_bindings.cc#L624-L627)

`node_cli_inspect` governs the allowed debug options: when the fuse is off, debug options such as `--inspect` are not accepted from the command line, and `CreateEnvironment` adds `kNoStartDebugSignalHandler` so `SIGUSR1` no longer starts the inspector.

Sources: [shell/common/node_bindings.cc:354-388](repo://shell/common/node_bindings.cc#L354-L388), [shell/common/node_bindings.cc:730-734](repo://shell/common/node_bindings.cc#L730-L734)

### only_load_app_from_asar

`CreateEnvironment` chooses between the full search list (`app.asar`, `app`, `default_app.asar`) and only `app.asar`, and stores the flag as a hidden global. `lib/browser/init.ts` reads both; when the flag is set it skips any candidate for which `_getOrCreateArchive` does not return an archive.

Sources: [shell/common/node_bindings.cc:679-700](repo://shell/common/node_bindings.cc#L679-L700), [lib/browser/init.ts:85-110](repo://lib/browser/init.ts#L85-L110)

### embedded_asar_integrity_validation

On macOS and Windows, the ASAR reader checks a header integrity record and aborts with a fatal log if an archive that should be validated has none; per-file integrity metadata is read when the fuse is on. Separately, the V8 snapshot validator hashes the snapshot with SHA-256 and `CHECK`s it against the checksum compiled into the binary.

Sources: [shell/common/asar/archive.cc:118-135](repo://shell/common/asar/archive.cc#L118-L135), [shell/common/asar/archive.cc:233-245](repo://shell/common/asar/archive.cc#L233-L245), [shell/app/electron_main_delegate.cc:216-230](repo://shell/app/electron_main_delegate.cc#L216-L230)

### load_browser_process_specific_v8_snapshot

`GetBrowserV8SnapshotFilename` returns `browser_v8_context_snapshot.bin` in the browser process when the fuse is on, and otherwise defers to the content layer's default file.

Sources: [shell/app/electron_main_delegate.cc:436-444](repo://shell/app/electron_main_delegate.cc#L436-L444)

### cookie_encryption

When on, `enable_encrypted_cookies` is set for persistent network contexts, and when the network service is out of process the OSCrypt key is sent to it.

Sources: [shell/browser/net/network_context_service.cc:110-117](repo://shell/browser/net/network_context_service.cc#L110-L117), [shell/browser/net/system_network_context_manager.cc:275-283](repo://shell/browser/net/system_network_context_manager.cc#L275-L283)

### grant_file_protocol_extra_privileges

This fuse is consulted in four places. `ProtocolRegistry` swaps Chromium's `file:` loader for the ASAR-aware loader. `ElectronContentClient` adds `file` to the service-worker schemes. `ElectronBrowserClient` sets `allow_universal_access_from_file_urls` and `allow_file_access_from_file_urls` from it. The renderer client registers `file` as supporting service workers and the Fetch API.

Sources: [shell/browser/protocol_registry.cc:23-34](repo://shell/browser/protocol_registry.cc#L23-L34), [shell/app/electron_content_client.cc:150-152](repo://shell/app/electron_content_client.cc#L150-L152), [shell/browser/electron_browser_client.cc:414-419](repo://shell/browser/electron_browser_client.cc#L414-L419), [shell/renderer/renderer_client_base.cc:282-287](repo://shell/renderer/renderer_client_base.cc#L282-L287)
