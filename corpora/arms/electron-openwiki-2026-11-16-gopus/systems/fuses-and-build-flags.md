---
type: system
title: Fuses and build flags
description: The three layers of Electron feature control — GN build flags compiled into the binary (buildflags/), runtime fuses stored in a sentinel-marked byte array that packagers can flip in the shipped executable (build/fuses/), and Chromium base::Feature defaults set by Electron's feature list initialisation.
tags: [fuses, buildflags, configuration, security, features]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T08:25:33.723Z
sources:
  - id: openwiki-source-ec2e5719a4f01093665ba043
    resource: repo://BUILD.gn
  - id: openwiki-source-8a35ee6a27dea5f50a49b698
    resource: repo://build/fuses/build.py
  - id: openwiki-source-948a7a9d83defa7e291d47d4
    resource: repo://build/fuses/fuses.json5
  - id: openwiki-source-fb17036690b0875a131877b5
    resource: repo://buildflags/BUILD.gn
  - id: openwiki-source-849c13b8a23bffaf7502b94b
    resource: repo://buildflags/buildflags.gni
  - id: openwiki-source-7f3026761c06b71bedda7de1
    resource: repo://shell/app/electron_main_delegate.cc
  - id: openwiki-source-b3fce888fb7314f90ce04e64
    resource: repo://shell/browser/electron_browser_main_parts.cc
  - id: openwiki-source-f2e80e49ca5bbc22aac2345a
    resource: repo://shell/browser/feature_list.cc
  - id: openwiki-source-faeca6fbe63873f226775fb0
    resource: repo://shell/common/api/features.cc
  - id: openwiki-source-7a563f98407b944e8311fdf4
    resource: repo://shell/common/node_bindings.cc
generated: { by: "claude-code", at: "2026-11-16T08:25:33.723Z" }
---

# Fuses and build flags

Electron has three distinct switches for behavior, differing in *who* can
change them and *when*:

| Mechanism | Changed by | When | Source |
| --- | --- | --- | --- |
| GN build flags | whoever builds Electron | compile time | `buildflags/` |
| Fuses | app packagers | after build, by patching the binary | `build/fuses/` |
| Chromium features | Electron defaults, then `--enable-features` / `--disable-features` / `app.commandLine` | process start | `shell/browser/feature_list.cc` |

## GN build flags

`buildflags/buildflags.gni` declares Electron's GN args:

- `enable_pdf_viewer` (default true)
- `enable_electron_extensions` — Chrome extensions support (default true)
- `enable_builtin_spellchecker` (default true)
- `enable_fake_location_provider` — mock geolocation for tests; defaults to
  `!is_official_build`
- `override_electron_version` — avoid reading the version from git tags
- `electron_vendor_version` — `"key:value"` added to `process.versions`

`buildflags/BUILD.gn` turns them into `buildflags.h` via Chromium's
`buildflag_header` (`ENABLE_PDF_VIEWER`, `ENABLE_ELECTRON_EXTENSIONS`,
`ENABLE_BUILTIN_SPELLCHECKER`, `OVERRIDE_LOCATION_PROVIDER`,
`HAS_VENDOR_VERSION`/`VENDOR_VERSION_NAME`/`VENDOR_VERSION_VALUE`). C++ guards
code with `#if BUILDFLAG(ENABLE_ELECTRON_EXTENSIONS)` etc., and
`filenames.gni` has matching optional source lists (e.g.
`lib_sources_extensions`).

The same header is fed to webpack, which defines each flag as a JS boolean
(see [JS bundles, module lists and native bindings](../architecture/js-bundles-and-native-bindings.md)).
At runtime JS can also query a subset through the `electron_common_features`
binding (`shell/common/api/features.cc`: `isPDFViewerEnabled`,
`isExtensionsEnabled`, `isBuiltinSpellCheckerEnabled`,
`isFakeLocationProviderEnabled`, `isPrintingEnabled`, `isComponentBuild`) —
used, for example, to skip specs for features not compiled in.

General Chromium/V8 GN args used by Electron are in `build/args/*.gn`; see
[GN build, DEPS and build configuration](../build/gn-build-and-deps.md).

## Fuses

Fuses are security-relevant toggles that an app author can flip **in the
final executable** without rebuilding Electron (tooling: `@electron/fuses`).

### Schema

`build/fuses/fuses.json5` lists fuses in a fixed order with defaults
(`"0"` off, `"1"` on, `"r"` removed). The file's rule: **never remove a
fuse or change its meaning**; mark it removed instead and bump `_version` for
breaking schema changes, because external tooling locates fuses by position.

| Fuse | Default | Consumer |
| --- | --- | --- |
| `run_as_node` | on | `ELECTRON_RUN_AS_NODE` honoured in `electron_main_*.cc` |
| `cookie_encryption` | off | encrypt cookies at rest with the OS keychain (`network_context_service.cc`, `system_network_context_manager.cc`) |
| `node_options` | on | `NODE_OPTIONS` / `NODE_EXTRA_CA_CERTS` honoured (`node_bindings.cc`, `node_main.cc`) |
| `node_cli_inspect` | on | `--inspect*` flags and the SIGUSR1 debug handler |
| `embedded_asar_integrity_validation` | off | ASAR header hash validation (macOS/Windows) |
| `only_load_app_from_asar` | off | only `app.asar` is searched for the app |
| `load_browser_process_specific_v8_snapshot` | off | browser process uses `browser_v8_context_snapshot.bin` |
| `grant_file_protocol_extra_privileges` | on | ASAR-aware `file://` loader with Electron's extra file privileges |

### Generated code and binary layout

The `electron_fuses` GN action runs `build/fuses/build.py`, generating
`fuses.h` / `fuses.cc` in `electron::fuses`:

- `kFuseWire[]` is a `const volatile char` array laid out as
  **sentinel string** `dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX`, one byte
  **fuse version**, one byte **wire length**, then one ASCII byte per fuse
  (`'0'`/`'1'`/`'r'`). `volatile` keeps the compiler from constant-folding
  reads so a patched byte takes effect.
- Each fuse gets an exported `bool Is<CamelName>Enabled()` that returns
  `kFuseWire[index] == '1'`.
- In DCHECK builds, `--set-fuse-<name>=1|0` overrides a fuse for testing
  (guarded so the very early RunAsNode check works before the command line is
  initialised).

External tools find the sentinel in the binary and rewrite bytes that follow
it; that is why order and meaning are frozen.

### Behavioral details worth knowing

- With `node_options` off, `NODE_OPTIONS` and `NODE_EXTRA_CA_CERTS` are
  removed (with a warning) and Node is initialised with
  `kDisableNodeOptionsEnv`. With it on, `NODE_OPTIONS` is still **filtered**:
  packaged apps only keep `--max-http-header-size` and `--http-parser`, and
  options incompatible with BoringSSL (`--openssl-config`, `--use-openssl-ca`,
  FIPS flags, etc.) are always dropped.
- With `node_cli_inspect` off, debug CLI flags are rejected and Node's
  SIGUSR1 inspector handler is not installed.
- `--expose-internals` is only allowed in unpackaged apps.

Related consumers: [ASAR archive support](asar-archives.md) and
[Process model and main-process startup](../architecture/process-model-and-startup.md).

## Chromium feature defaults

`InitializeFeatureList()` (`shell/browser/feature_list.cc`, called from
`ElectronBrowserMainParts::PreEarlyInitialization`) reads the user's
`--enable-features` / `--disable-features` and **appends** Electron's own
overrides before calling `base::FeatureList::InitInstance`. Electron
disables, among others, `SpareRendererForSitePerProcess` (it conflicts with
Electron's per-WebContents renderer process preferences when Node integration
is used), Screen AI OCR, and on macOS `MacWebContentsOcclusion`; it enables
`PdfUseShowSaveFilePicker` when the PDF viewer is built. Platform-specific
additions come from `EnablePlatformSpecificFeatures` /
`DisablePlatformSpecificFeatures` (`feature_list_mac.mm`). Field trials can be
forced with `--force-fieldtrials`.

Electron-defined `base::Feature`s also exist, e.g.
`ContextBridgeMutability` in the context bridge (see
[Renderer processes, sandboxing and context isolation](../architecture/renderer-processes-and-sandboxing.md)).
