---
type: concept
title: Fuses and ASAR Integrity
description: Build-time fuses are compile-time boolean switches that turn runtime features on or off, such as NODE_OPTIONS, the --inspect flags, ASAR-only app loading, and embedded ASAR integrity validation. This page covers how fuse defaults are declared, generated into the binary, read at runtime, and overridden in test builds, and which subsystems consult each fuse.
tags: [fuses, integrity, asar, security, build-flags, node-options, runtime-features]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T11:29:50.477Z
sources:
  - id: openwiki-source-ec2e5719a4f01093665ba043
    resource: repo://BUILD.gn
  - id: openwiki-source-8a35ee6a27dea5f50a49b698
    resource: repo://build/fuses/build.py
  - id: openwiki-source-948a7a9d83defa7e291d47d4
    resource: repo://build/fuses/fuses.json5
  - id: openwiki-source-7f3026761c06b71bedda7de1
    resource: repo://shell/app/electron_main_delegate.cc
  - id: openwiki-source-b326c72eb64dde6d23fbe693
    resource: repo://shell/app/node_main.cc
  - id: openwiki-source-7b7d7365d3a1256ae14d83e7
    resource: repo://shell/browser/net/network_context_service.cc
  - id: openwiki-source-d885d8409dce109998cad17e
    resource: repo://shell/browser/protocol_registry.cc
  - id: openwiki-source-7a563f98407b944e8311fdf4
    resource: repo://shell/common/node_bindings.cc
  - id: openwiki-source-e0fec9f0a137ad7f2c466264
    resource: repo://spec/fuses-spec.ts
generated: { by: "claude-code", at: "2026-11-16T11:29:50.477Z" }
---

# Fuses and ASAR Integrity

A fuse is a single byte in the Electron binary that enables or disables one feature. Fuses let an app builder turn off risky behavior, such as `ELECTRON_RUN_AS_NODE` or `NODE_OPTIONS`, after the binary is built, and let the operating system's code-signing checks protect the result. The fuse list lives in `build/fuses/fuses.json5`. Its values are written into the binary at build time and read by native code at start-up.

## Declaration

`build/fuses/fuses.json5` lists each fuse with a default value and a schema comment:

- `_version` is the fuse wire version (currently `1`). The comment says that a breaking schema change must increment it, and that a fuse must never be removed or have its meaning changed. A retired fuse is marked `r` instead.
- Each fuse is `"0"` (off) or `"1"` (on). The current fuses are `run_as_node`, `cookie_encryption`, `node_options`, `node_cli_inspect`, `embedded_asar_integrity_validation`, `only_load_app_from_asar`, `load_browser_process_specific_v8_snapshot`, and `grant_file_protocol_extra_privileges`.

The defaults are the values that ship in an unpackaged binary. Packaging tools can flip them with the `@electron/fuses` package, which is documented in `docs/tutorial/fuses.md`.

## Generation

`BUILD.gn` declares an `action("electron_fuses")` (around line 395) that runs `build/fuses/build.py` on `fuses.json5`, producing `fuses.h` and `fuses.cc` in the generated directory. `build.py`:

1. Reads `fuses.json5`, drops the comment lines, and removes the `_schema`, `_comment`, and `_version` keys from the defaults.
2. Builds one wire string from the fuse values, prefixed by a 32-byte sentinel, a version byte, and a length byte.
3. Emits a `kFuseWire` array and one `Is<Name>Enabled()` function per fuse. Each function reads `kFuseWire[index] == '1'`.

The header declares the wire as a `volatile` array, and the sentinel marks where it sits in the built binary, so that packaging tools can locate and rewrite the bytes.

## Runtime checks

In a debug (DCHECK) build, each getter first checks for a `--set-fuse-<name>=<0|1>` command-line switch and uses its value if present. Release builds ignore the switch. The test suite relies on this (see `spec/fuses-spec.ts`), which lets specs toggle a fuse without re-packaging.

Each fuse is consulted in a specific subsystem:

| Fuse | Consulted by | Effect when off |
| --- | --- | --- |
| `run_as_node` | `shell/app/electron_main_linux.cc`, `electron_main_mac.cc`, `electron_main_win.cc`, `electron_library_main.mm`, `shell/common/crash_keys.cc` | `ELECTRON_RUN_AS_NODE` is ignored, so the binary cannot be started as plain Node.js. |
| `node_options` | `shell/common/node_bindings.cc` (several places), `shell/app/node_main.cc` | `NODE_OPTIONS` and `NODE_EXTRA_CA_CERTS` are removed from the environment at start-up in `NodeMain`, and the bindings log a warning when `NODE_OPTIONS` is ignored. |
| `node_cli_inspect` | `shell/common/node_bindings.cc` (around line 387) | The `--inspect` family of flags is not honored. |
| `only_load_app_from_asar` | `shell/common/node_bindings.cc` (around lines 680-700) | The app search list is reduced to `app.asar`. See [ASAR Archives and Module Loading](../architecture/asar-and-module-loading.md). |
| `embedded_asar_integrity_validation` | `shell/common/asar/archive.cc`, `shell/app/electron_main_delegate.cc` | Header and per-file integrity checks run on macOS and Windows, and the V8 startup snapshot is verified. |
| `cookie_encryption` | `shell/browser/net/network_context_service.cc`, `system_network_context_manager.cc` | The cookie store is created with encryption enabled when this is on. |
| `grant_file_protocol_extra_privileges` | `shell/browser/protocol_registry.cc`, `shell/browser/electron_browser_client.cc`, `shell/renderer/renderer_client_base.cc`, `shell/app/electron_content_client.cc` | `file://` pages do not get the extra privileges Electron grants on top of Chromium's behavior. |
| `load_browser_process_specific_v8_snapshot` | `shell/app/electron_main_delegate.cc` (around line 437) | The browser process loads `browser_v8_context_snapshot.bin` instead of the shared snapshot. |

## Integrity validation

`embedded_asar_integrity_validation` is the fuse that connects fuses to the archive. When it is on, the ASAR header's integrity payload is required and verified on macOS and Windows, and the V8 snapshot is checked against a compiled-in SHA-256. The failure is fatal by design. For the mechanics, see [ASAR Archives and Module Loading](../architecture/asar-and-module-loading.md).

Used together, `embedded_asar_integrity_validation` and `only_load_app_from_asar` mean that the only code the app can load is the archive that was validated at build time. The fuses page in the user documentation describes this combination as the way to make non-validated code impossible to load.

## Invariants and consequences

- Fuse values are fixed when the binary is packaged. Code cannot change them at run time.
- The wire layout is part of the binary format. Adding a fuse appends it to the wire. Removing one, or changing the meaning of an existing fuse, would break existing packaged apps, which is why the schema comment forbids it.
- Disabling `run_as_node` changes how `process.fork` behaves in the main process, because that call depends on `ELECTRON_RUN_AS_NODE`. The user documentation recommends utility processes for standalone Node.js children (see [Process Model and Startup](../architecture/process-model.md)).
- `cookie_encryption` is one-way on existing data. Enabling it encrypts cookies as they are written. Disabling it later leaves the store unreadable, according to the user documentation.

## Extension seams

- New fuses are added as new keys in `fuses.json5`, with a new default value. The generator derives the getter name from the key, for example `run_as_node` becomes `IsRunAsNodeEnabled`.
- New checks use the generated getter directly, for example `electron::fuses::IsNodeOptionsEnabled()`, after including `electron/fuses.h`.

## Related pages

- [ASAR Archives and Module Loading](../architecture/asar-and-module-loading.md)
- [Code Signing, Packaging, and Distribution Artifacts](code-signing-and-packaging.md)
- [Building Electron with GN and Ninja](../workflows/build-and-gn.md)

## Focused tests

- `spec/fuses-spec.ts` covers `--set-fuse-node_options`, `--set-fuse-node_cli_inspect`, and `--set-fuse-grant_file_protocol_extra_privileges` in test builds.
- `spec/asar-integrity-spec.ts` covers integrity-enabled loading.
