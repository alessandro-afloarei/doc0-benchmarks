---
type: security
title: Fuses and Security Model
description: How Electron's package-time fuses are defined, compiled into a sentinel-marked byte array and read at runtime, what each of the eight fuses changes, plus the secure defaults and environment/CLI restrictions (NODE_OPTIONS filtering, inspector flags, sandbox, context isolation) enforced in the native layer.
tags: [fuses, security, sandbox, node-options, run-as-node, cookie-encryption]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T09:55:01.404Z
sources:
  - id: openwiki-source-8a35ee6a27dea5f50a49b698
    resource: repo://build/fuses/build.py
  - id: openwiki-source-948a7a9d83defa7e291d47d4
    resource: repo://build/fuses/fuses.json5
  - id: openwiki-source-7acba2ef088bdb93302ae4ab
    resource: repo://shell/app/electron_content_client.cc
  - id: openwiki-source-d9f1d2383a518360722e4aba
    resource: repo://shell/app/electron_main_linux.cc
  - id: openwiki-source-4501ff94ff2d4a6dc9e0dfeb
    resource: repo://shell/app/electron_main_mac.cc
  - id: openwiki-source-25061abd2b5a1b1967512015
    resource: repo://shell/app/electron_main_win.cc
  - id: openwiki-source-b326c72eb64dde6d23fbe693
    resource: repo://shell/app/node_main.cc
  - id: openwiki-source-f0ec114ee70f9e6816af1872
    resource: repo://shell/browser/electron_browser_client.cc
  - id: openwiki-source-7b7d7365d3a1256ae14d83e7
    resource: repo://shell/browser/net/network_context_service.cc
  - id: openwiki-source-d885d8409dce109998cad17e
    resource: repo://shell/browser/protocol_registry.cc
  - id: openwiki-source-7a563f98407b944e8311fdf4
    resource: repo://shell/common/node_bindings.cc
  - id: openwiki-source-716a2a2e8bfb52ac62f2cd25
    resource: repo://shell/renderer/renderer_client_base.cc
generated: { by: "claude-code", at: "2026-11-16T09:55:01.404Z" }
---

# Fuses and Security Model

Electron ships one binary for every app, so many capabilities (running as plain Node, `NODE_OPTIONS`, `--inspect`, loading unpacked app code, ...) must be enabled in the shared binary but are undesirable in production apps. **Fuses** are package-time switches: bytes in the Electron executable that an app flips *before code signing*, so the OS's signature validation prevents anyone from flipping them back.

## Definition and generation

- `build/fuses/fuses.json5` is the schema and default list. It begins with a warning that breaking changes need a `_version` bump and that fuses must **never be removed or repurposed**; retired fuses are marked `r`. `_schema` says `0` is off, `1` on, `r` removed.
- Current defaults (wire order matters): `run_as_node` on, `cookie_encryption` off, `node_options` on, `node_cli_inspect` on, `embedded_asar_integrity_validation` off, `only_load_app_from_asar` off, `load_browser_process_specific_v8_snapshot` off, `grant_file_protocol_extra_privileges` on.
<!-- openwiki: broken internal link [/openwiki/build/build-system.md] link "/openwiki/build/build-system.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- `build/fuses/build.py` (run by the `electron_fuses` GN action, see [build system](/openwiki/build/build-system.md)) turns that into `fuses.h` and `fuses.cc`. The generated source has a `kFuseWire` array holding a 32-byte sentinel string, the schema version, the wire length, and one ASCII `'0'`/`'1'` character per fuse. Each fuse gets an `Is<CamelName>Enabled()` accessor reading `kFuseWire[index]`. The array is `volatile` and exported so that tools can locate it by sentinel and flip bytes in the shipped binary. The version must fit in one byte.
- In `DCHECK`-enabled builds the accessor first checks for a `--set-fuse-<name>=1|0` command-line switch, which lets tests flip fuses without rewriting the binary (and guards on `CommandLine` being initialized, since `run_as_node` is read before it is).
- Apps flip fuses with `@electron/fuses` (`flipFuses`, or `npx @electron/fuses read` to inspect); see `docs/tutorial/fuses.md`.

## What each fuse controls

| Fuse | Effect when set as noted | Where enforced |
| --- | --- | --- |
| `run_as_node` | When on, `ELECTRON_RUN_AS_NODE` turns the binary into plain Node. Disable to remove that capability (also breaks `child_process.fork`, whose Electron wrapper depends on it). | per-OS `main` in `shell/app/electron_main_*.cc`, `electron_library_main.mm`, crash keys |
| `cookie_encryption` | Encrypts the on-disk cookie store with OS keys. One-way: after enabling, disabling again corrupts the store. | `network_context_params->enable_encrypted_cookies` in `network_context_service.cc` and `system_network_context_manager.cc` |
| `node_options` | When off, `NODE_OPTIONS` and `NODE_EXTRA_CA_CERTS` are ignored/unset. | `SetNodeOptions` and `Initialize` in `node_bindings.cc`, `NodeMain` |
| `node_cli_inspect` | When off, `--inspect*`, `--debug*` and `--experimental-network-inspection` are rejected and `SIGUSR1` does not start the inspector. | `IsAllowedOption`, env flag `kNoStartDebugSignalHandler` in `node_bindings.cc` |
| `embedded_asar_integrity_validation` | Validates the ASAR header and per-file hashes on macOS/Windows; failures are fatal. Also checks the V8 snapshot checksum. | `shell/common/asar/archive.cc`, `electron_main_delegate.cc` |
| `only_load_app_from_asar` | App search path becomes only `app.asar` (not `app/` or `default_app.asar`). | `node_bindings.cc` (`appSearchPaths`), `lib/browser/init.ts` |
| `load_browser_process_specific_v8_snapshot` | Browser process loads `browser_v8_context_snapshot.bin`, keeping renderer snapshots separate. | `ElectronMainDelegate::GetBrowserV8SnapshotFilename` |
| `grant_file_protocol_extra_privileges` | When on, `file://` pages get `allow_universal_access_from_file_urls`, `allow_file_access_from_file_urls`, service-worker and fetch support, and the ASAR-aware `file:` loader. Disable if you serve local content through a custom protocol. | `electron_browser_client.cc` (`OverrideWebPreferences`), `renderer_client_base.cc`, `electron_content_client.cc`, `protocol_registry.cc` |

<!-- openwiki: broken internal link [/openwiki/architecture/utility-processes-and-asar.md] link "/openwiki/architecture/utility-processes-and-asar.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
Details of the ASAR pair are in [utility processes and ASAR](/openwiki/architecture/utility-processes-and-asar.md); documentation of defaults for apps lives in `docs/tutorial/fuses.md` and `docs/tutorial/asar-integrity.md`. Fuses interact: `only_load_app_from_asar` plus `embedded_asar_integrity_validation` is what makes it impossible to load unvalidated app code.

## Node environment hardening

Even with fuses on, the native layer restricts what Node flags can do:

- **`NODE_OPTIONS`** (when the `node_options` fuse allows it) is parsed and filtered in `SetNodeOptions`: for *packaged* apps only `--http-parser` and `--max-http-header-size` are allowed and everything else is dropped with an error log; in all cases `--enable-fips`, `--force-fips`, `--openssl-config`, `--use-bundled-ca`, `--use-openssl-ca` and `--experimental-policy` are removed because BoringSSL doesn't support them. `NODE_EXTRA_CA_CERTS` is unset when the fuse is off.
- **CLI flags in normal mode.** `IsAllowedOption` accepts only a small set (diagnostic dir, DNS result order, deprecation and warning flags, `--no-experimental-global-navigator`), debug options only if `node_cli_inspect` is enabled, and `--expose-internals` only for unpackaged apps.
<!-- openwiki: broken internal link [/openwiki/architecture/process-model.md] link "/openwiki/architecture/process-model.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- **Run-as-node mode.** `NodeMain` exits with status 9 if any of the FIPS/OpenSSL/CA flags are passed, strips the environment when `node_options` is off, and on macOS drops injection-prone environment variables when the parent process isn't signed as the same app ([process model](/openwiki/architecture/process-model.md)).
- **Unhandled rejections** in browser, renderer and utility environments are `warn-with-error-code` rather than crashing the process, and non-utility environments never abort on uncaught exceptions.

## Secure defaults in web content

Electron's defaults are summarized in `docs/tutorial/security.md`; the native enforcement points are:

<!-- openwiki: broken internal link [/openwiki/architecture/renderer-preload-and-isolation.md] link "/openwiki/architecture/renderer-preload-and-isolation.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- `WebContentsPreferences` defaults: `nodeIntegration` off, `contextIsolation` on, sandbox on unless Node integration is requested ([renderer, preload and isolation](/openwiki/architecture/renderer-preload-and-isolation.md)). The sandboxed renderer's preload `require` is an allow-list.
- Blink preferences set in `ElectronBrowserClient::OverrideWebPreferences`: `web_security_enabled = true`, `allow_running_insecure_content = false`, `dom_paste_enabled = false`, `javascript_can_access_clipboard = false`.
<!-- openwiki: broken internal link [/openwiki/architecture/web-contents-and-windows.md] link "/openwiki/architecture/web-contents-and-windows.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- `<webview>` guests inherit `contextIsolation`, `sandbox` and `nodeIntegration=false`-style settings from the embedder and can be vetoed ([WebContents and windows](/openwiki/architecture/web-contents-and-windows.md)).
<!-- openwiki: broken internal link [/openwiki/architecture/sessions-protocols-and-network.md] link "/openwiki/architecture/sessions-protocols-and-network.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- Permission handling is permissive by default unless the app installs handlers ([sessions and permissions](/openwiki/architecture/sessions-protocols-and-network.md)).
<!-- openwiki: broken internal link [/openwiki/architecture/ipc.md] link "/openwiki/architecture/ipc.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- Internal IPC channels are separate from public ones, so web content cannot invoke internal handlers ([IPC](/openwiki/architecture/ipc.md)).
- The renderer-side `process`/`require` in sandboxed preloads exposes only a whitelisted subset, and `contextBridge` copies values rather than sharing prototypes.
- Linux refuses to start as root with the sandbox enabled; the browser-process launcher verifies that child helper executables are the expected binary.

## Extension seams and rules

- Adding a fuse: append to `fuses.json5` **at the end** (the wire is positional), bump `_version` only for breaking schema changes, never reuse a removed slot, and consume it through the generated `Is<Name>Enabled()` accessor. Update the docs and the test in `spec/fuses-spec.ts`.
- Security-sensitive behavior changes should be gated on a fuse when apps may reasonably need the old behavior.
- Tests: `spec/fuses-spec.ts`, `spec/asar-integrity-spec.ts`, `spec/node-spec.ts` (run-as-node and flag handling).
