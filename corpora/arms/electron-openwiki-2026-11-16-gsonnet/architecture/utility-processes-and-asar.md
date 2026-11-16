---
type: architecture
title: Utility Processes, Node Service and ASAR Archives
description: How utilityProcess.fork launches a sandbox-free Node.js child through the NodeService Mojo service and parent-port messaging, how child_process.fork reuses the binary in run-as-node mode, and how ASAR archives are virtualized in Node's fs, Chromium's loaders, and verified by integrity hashes.
tags: [utility-process, node-service, asar, integrity, mojo, architecture]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T09:55:01.404Z
sources:
  - id: openwiki-source-85151ea4a0ecb0d852396c8e
    resource: repo://lib/browser/init.ts
  - id: openwiki-source-fc70a27ce2ad9ad66fb961ef
    resource: repo://lib/node/asar-fs-wrapper.ts
  - id: openwiki-source-0b7fa519832032182e66e802
    resource: repo://lib/node/init.ts
  - id: openwiki-source-f0fd38de25eeb7a8f5bbd940
    resource: repo://lib/utility/init.ts
  - id: openwiki-source-e6d7b1ad0cf2d9581655aad2
    resource: repo://lib/utility/parent-port.ts
  - id: openwiki-source-24b9fe87828b46683807734f
    resource: repo://shell/browser/api/electron_api_utility_process.cc
  - id: openwiki-source-dc18a0674c36202c6677a719
    resource: repo://shell/common/asar/archive_mac.mm
  - id: openwiki-source-a80d965312b6d4ace23f3bad
    resource: repo://shell/common/asar/archive.cc
  - id: openwiki-source-3cab3a01c25f9816da6caf08
    resource: repo://shell/common/asar/asar_util.cc
  - id: openwiki-source-7a563f98407b944e8311fdf4
    resource: repo://shell/common/node_bindings.cc
  - id: openwiki-source-48c2f19b8838015a32bac539
    resource: repo://shell/services/node/node_service.cc
  - id: openwiki-source-bc373bb2272757b7d01f0db8
    resource: repo://shell/services/node/public/mojom/node_service.mojom
  - id: openwiki-source-71ad6f6b59238a1b3c4ef296
    resource: repo://shell/utility/electron_content_utility_client.cc
generated: { by: "claude-code", at: "2026-11-16T09:55:01.404Z" }
---

# Utility Processes, Node Service and ASAR Archives

Two related subsystems let Electron run Node.js code outside the main process and ship apps as single-file archives: **utility processes** (and the lighter `ELECTRON_RUN_AS_NODE` mode) and **ASAR** virtualization.

## utilityProcess.fork

### Main-process side

`utilityProcess.fork(modulePath, args, options)` is `ForkUtilityProcess` in `lib/browser/api/utility-process.ts`. It validates `execArgv`, `serviceName`, `cwd` and `stdio` (stdin must be `ignore`; stdout/stderr may be `inherit`, `ignore` or `pipe`, with `pipe` giving `PassThrough` streams), then calls the native `_fork`. The native handle's `emit` is overridden so `exit` is re-emitted and cleans up stream state, and `stdout`/`stderr` file descriptors are wrapped into `net.Socket`s piped to those streams. `postMessage` unwraps `MessagePortMain`s to their internal ports.

`UtilityProcessWrapper` (`shell/browser/api/electron_api_utility_process.cc`) does the heavy lifting:

- It launches the child with `content::ServiceProcessHost::Launch` for the `node.mojom.NodeService` interface, display name from `serviceName` (default "Node Utility Process"), extra command-line switches from `execArgv`, the requested working directory, and the environment (inherited unless a custom environment is supplied). Stdout/stderr are routed to `/dev/null` fds on POSIX or pipe handles on Windows depending on `stdio`; on macOS `allowLoadingUnsignedLibraries` selects the plugin-helper child flavor.
- A separate Mojo message pipe (`MessagePortDescriptorPair`) backs `postMessage`, wrapped in a `mojo::Connector`, so messages queue independently of the `NodeService` interface. The other end is handed to the child inside `NodeServiceParams.port`.
- It also creates a `URLLoaderFactory` and `HostResolver` from the system network context manager's `NetworkContext` and passes them in `NodeServiceParams`, so `net` works inside the child (not tied to any `Session`).
- A global map (keyed by pid) lets `ElectronBrowserMainParts::PostMainMessageLoopRun` find and shut down all utility processes before stopping Node so `exit` events fire.
- Events: `spawn` once the process is launched, `exit` with the exit code (SIGTERM/SIGKILL after `kill()` are normalized to 0 on POSIX), and `message`. Termination from clean exit, crash or Mojo disconnect all funnel into `HandleTermination`, which runs once.

### Child side: the Node service

`shell/services/node/node_service.cc` implements `NodeService` (`shell/services/node/public/mojom/node_service.mojom`, annotated `ServiceSandbox=kNoSandbox`, so these processes are **not sandboxed**). The utility client (`shell/utility/electron_content_utility_client.cc`) registers it via `services.Add(RunNodeService)`. On `Initialize(params, client)` it:

1. Binds the client remote and parent port, and stores the URL loader factory and host resolver in `URLLoaderBundle`.
2. Creates `JavascriptEnvironment` and a `kUtility` `NodeBindings`, prepends `argv0`, builds the Node environment with the supplied args and exec args, installs a process exit handler that tears down the parent port, microtask runner and the Mojo receiver with reason `process_exit_termination` (which is how the browser learns of a voluntary `process.exit`), and sets `unhandled_rejections` to `warn-with-error-code`.
<!-- openwiki: broken internal link [/openwiki/architecture/node-chromium-integration.md] link "/openwiki/architecture/node-chromium-integration.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
3. Stores the entry script as the hidden `_serviceStartupScript` on `process`, creates the microtask runner **before** `LoadEnvironment` (so uncaught exceptions during startup can shut down cleanly), then loads the environment and starts the embed thread and polling ([details](/openwiki/architecture/node-chromium-integration.md)).

`lib/utility/init.ts` then restores `process.argv[1]` to the entry script, runs the common init, defines the read-only `process.parentPort` (`lib/utility/parent-port.ts`, an `EventEmitter` over the native `createParentPort()` that starts/pauses the port when `message` listeners are added/removed, mirroring `worker_threads`), and imports the entry script through the ESM loader (so both CJS and ESM entries work), routing failures to Node's uncaught-exception path. In utility processes, unlike browser/renderer, Node aborts on uncaught exceptions as a standard runtime would.

## ELECTRON_RUN_AS_NODE and child_process.fork

<!-- openwiki: broken internal link [/openwiki/architecture/process-model.md] link "/openwiki/architecture/process-model.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
When the `run_as_node` fuse is on and `ELECTRON_RUN_AS_NODE` is set, the binary behaves as plain Node (`NodeMain` in `shell/app/node_main.cc`, see [process model](/openwiki/architecture/process-model.md)). `lib/node/init.ts` (the `node` bundle) wraps `child_process.fork` so children get `ELECTRON_RUN_AS_NODE=1` (using the helper executable on macOS), restricts `Module._nodeModulePaths` for code inside `resources/` so lookups don't escape the app, restores Blink's fetch family, and applies ASAR support to `fs`.

## ASAR archives

An `.asar` file is a simple archive: an 8-byte pickle giving the header size, a JSON header (tree of `files` with `size`, `offset`, `unpacked`, `executable`, optional `link`, and `integrity`), then concatenated file bodies. Files marked `unpacked` live next to the archive in `<name>.asar.unpacked`.

### In Node (`lib/node/asar-fs-wrapper.ts`)

`wrapFsWithAsar(fs)` is applied at Node init in every process that loads the node init path. It monkey-patches `fs` (sync, callback and `fs.promises` variants of `stat`, `lstat`, `readFile`, `readdir`, `realpath`, `access`, `exists`, `open/read`, `readFileSync`, etc.), `Module._extensions['.node']` and `child_process.execFile*`:

- Any path with an `.asar` component is split into archive path and inner path (`splitPath`); archives are cached by path via the native `asar.Archive` binding.
- Reads are served from the archive offsets. For operations that need a real file (native addons, `execFile`, `copyFile`, etc.), `archive.copyFileOut()` extracts the file to a temp location and the call is redirected to it. Missing inner paths produce `ENOENT`-style errors and invalid archives `INVALID_ARCHIVE` errors.
- `process.noAsar = true` (or `ELECTRON_NO_ASAR` outside browser/renderer) disables the behavior, and `ELECTRON_LOG_ASAR_READS` logs read offsets.
- JS-side integrity check: `validateBufferIntegrity` hashes the bytes with the file's declared algorithm and calls `process.exit(1)` after logging `ASAR Integrity Violation` on mismatch.

### In native code (`shell/common/asar/`)

<!-- openwiki: broken internal link [/openwiki/architecture/sessions-protocols-and-network.md] link "/openwiki/architecture/sessions-protocols-and-network.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
`asar::Archive` parses the header and exposes `Stat`, `Readdir`, `Realpath`, `CopyFileOut` and file info; `GetOrCreateAsarArchive` caches archives under a lock, and `GetAsarArchivePath` walks up a path to find the first `.asar` component that is not a real directory. Chromium-side consumers use the same helpers: `AsarURLLoaderFactory` serves `file://` URLs inside archives (installed by `ProtocolRegistry` when the `grant_file_protocol_extra_privileges` fuse is on, see [sessions and protocols](/openwiki/architecture/sessions-protocols-and-network.md)) and `asar::ReadFileToString` (used for example by `skia_util.cc` to load images) validates per-file integrity.

### Integrity and the app search path

- The `embedded_asar_integrity_validation` fuse enables validation on macOS and Windows. When on, `Archive::Init` validates the SHA-256 of the **header** against a hash embedded in the app (on macOS the `ElectronAsarIntegrity` dictionary in `Info.plist`, read by `Archive::HeaderIntegrity()` in `archive_mac.mm`, keyed by the archive's path relative to the bundle; Windows reads it from an executable resource); failure is fatal (`LOG(FATAL)`). Per-file entries must carry an `integrity` record (algorithm `SHA256`, overall `hash`, `blockSize`, per-block hashes), and a missing record is fatal; `ValidateIntegrityOrDie` terminates the process on mismatch.
<!-- openwiki: broken internal link [/openwiki/security/fuses-and-security-model.md] link "/openwiki/security/fuses-and-security-model.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- The `only_load_app_from_asar` fuse restricts `appSearchPaths` to `app.asar` only (excluding the unpacked `app/` directory) and sets `appSearchPathsOnlyLoadASAR`, which `lib/browser/init.ts` consults when locating `package.json`. Together the fuses stop an attacker from swapping in an unpacked app directory or a tampered archive. See [fuses and security model](/openwiki/security/fuses-and-security-model.md).

## Tests

`spec/api-utility-process-spec.ts`, `spec/asar-spec.ts`, `spec/asar-integrity-spec.ts`, `spec/fuses-spec.ts` and `spec/node-spec.ts` cover utility processes, ASAR semantics, integrity and run-as-node behavior.
