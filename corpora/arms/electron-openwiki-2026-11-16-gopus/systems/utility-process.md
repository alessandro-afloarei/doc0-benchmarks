---
type: system
title: Utility processes
description: How utilityProcess.fork launches a Chromium utility process hosting a Node.js environment — option validation in lib/browser/api/utility-process.ts, UtilityProcessWrapper launching NodeService via ServiceProcessHost, the dedicated postMessage pipe and process.parentPort, network access through a browser-provided URL loader factory, stdio piping, and spawn/exit/error lifecycle.
tags: [utility-process, node, mojo, process-model, ipc]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T08:25:33.723Z
sources:
  - id: openwiki-source-f788662ecd080d1991e2a178
    resource: repo://lib/browser/api/utility-process.ts
  - id: openwiki-source-daf8489ae2103f9525b40d35
    resource: repo://lib/utility/api/exports/electron.ts
  - id: openwiki-source-e5b488b69c6439bfca23793e
    resource: repo://lib/utility/api/module-list.ts
  - id: openwiki-source-f0fd38de25eeb7a8f5bbd940
    resource: repo://lib/utility/init.ts
  - id: openwiki-source-24b9fe87828b46683807734f
    resource: repo://shell/browser/api/electron_api_utility_process.cc
  - id: openwiki-source-5ced56223af74af933439365
    resource: repo://shell/browser/login_handler.cc
  - id: openwiki-source-7a563f98407b944e8311fdf4
    resource: repo://shell/common/node_bindings.cc
  - id: openwiki-source-48c2f19b8838015a32bac539
    resource: repo://shell/services/node/node_service.cc
  - id: openwiki-source-7e8956915b2351426cc26a68
    resource: repo://shell/services/node/parent_port.cc
generated: { by: "claude-code", at: "2026-11-16T08:25:33.723Z" }
---

# Utility processes

`utilityProcess.fork(modulePath, args, options)` starts a child process that
behaves like a Node.js child but is launched and supervised by Chromium as a
**utility process**, with a message channel to the main process. It is the
recommended replacement for `child_process.fork` when you need
`MessagePort`s, Chromium networking, or Chromium's process management.

## Main-process side

### JS wrapper: `lib/browser/api/utility-process.ts`

`ForkUtilityProcess` (an `EventEmitter`) validates arguments before calling
the native `_fork`:

- `modulePath` is required; `args` may be omitted (an object in that position
  is treated as `options`).
- `execArgv` must be an array; `serviceName` and `cwd` must be strings.
- `stdio`: `'inherit' | 'ignore' | 'pipe'` or a 3-element array; **stdin must
  be `'ignore'`**. `'pipe'` creates `PassThrough` streams exposed as
  `child.stdout` / `child.stderr`.

It overrides the native handle's `emit`: `stdout`/`stderr` events carry file
descriptors that are wrapped in `net.Socket`s and piped into the
PassThroughs; `exit` is re-emitted and then the handle and streams are
released. `postMessage(message, transfer)` unwraps `MessagePortMain`s;
`kill()` returns `false` once the process has exited; `pid` is `undefined`
until spawn or after exit.

### Native: `UtilityProcessWrapper`

`shell/browser/api/electron_api_utility_process.cc`:

- **Options** parsed from JS include `env` (a custom env *replaces* the
  parent environment; omitted means inherit), `execArgv` (passed as extra
  switches), `serviceName` (display name, default "Node Utility Process"),
  `cwd`, stdio, `allowLoadingUnsignedLibraries` (macOS: launch as a plugin
  child) and `respondToAuthRequestsFromMainProcess`.
- **Launch** uses `content::ServiceProcessHost::Launch` for the
  `node::mojom::NodeService` interface, setting up stdio pipes/fds per
  platform. The wrapper `Pin()`s itself so it stays alive while the process
  runs.
- **Networking**: it creates a URL loader factory and host resolver from the
  system network context and sends them in `NodeServiceParams`. With
  `respondToAuthRequestsFromMainProcess`, a `URLLoaderNetworkObserver` is
  attached so auth challenges from the child surface as `app` `login` events
  in the main process.
- **Messaging**: a dedicated message pipe (a `mojo::Connector`) carries
  `blink.mojom.TransferableMessage`s for `postMessage`, separate from the
  `NodeService` interface so messages can be queued without blocking it.
  Incoming messages are deserialised and emitted as `message`.
- **Lifecycle**: `OnServiceProcessLaunch` records the pid, emits
  `stdout`/`stderr` fds and then **`spawn`**. Termination can be observed via
  normal exit, crash, or a `process_exit_termination` disconnect;
  `HandleTermination` deduplicates these, closes the port, emits **`exit`**
  with the code and `Unpin()`s. After `kill()` (SIGTERM via
  `base::Process::Terminate`) a POSIX exit code of SIGTERM/SIGKILL is
  normalised to 0. V8 fatal errors in the child are reported as
  `error` (`'FatalError'`, location, report).

## Child-process side

`ElectronContentUtilityClient` (`shell/utility/electron_content_utility_client.cc`)
registers `RunNodeService`, so the utility process instantiates
`electron::NodeService` (`shell/services/node/node_service.cc`). In
`Initialize` it:

1. initialises `ParentPort` with the message pipe from the browser and stores
   the URL loader factory / host resolver in the `URLLoaderBundle` singleton
   (used by `net` in this process; see
   [Sessions, protocols and networking](sessions-protocols-and-networking.md));
2. creates a `JavascriptEnvironment` and a Node environment of kind
   `kUtility`, entry `electron/js2c/utility_init`, with the program path as
   `argv0` and `unhandled_rejections = "warn-with-error-code"`;
3. installs a process-exit handler that closes the parent port and resets the
   service receiver with reason `process_exit_termination` (which the browser
   maps to `exit`);
4. stores the user script as hidden `_serviceStartupScript`, loads the
   environment and starts uv polling.

Unlike browser and renderer environments, uncaught exceptions in a utility
process are **not** suppressed — the process behaves like Node and exits
(see `should_abort_on_uncaught_exception_callback` in
`shell/common/node_bindings.cc`).

`lib/utility/init.ts` restores `process.argv[1]` to the entry script, runs
common init, defines read-only `process.parentPort`, and loads the entry
through Node's ESM-capable loader. `ParentPort`
(`lib/utility/parent-port.ts`, native `shell/services/node/parent_port.cc`)
is an `EventEmitter` whose underlying connector starts **paused** and is
started when the first `message` listener is added and paused when the last
is removed (mirroring Node's worker `MessagePort`). Received transferred ports
become `MessagePortMain` objects.

### Available APIs

The utility process registers `ELECTRON_UTILITY_BINDINGS` only
(`electron_browser_event_emitter`, `electron_browser_system_preferences`,
`electron_common_net`, `electron_utility_parent_port`) plus common bindings.
`require('electron')` there exposes only `net` and `systemPreferences`
(`lib/utility/api/module-list.ts`; the utility `exports/electron.ts` does not
add the common module list). Browser-only APIs such as `BrowserWindow` are
unavailable.

## Related

- Message ports and IPC semantics: [IPC between main and renderer](ipc.md).
- How the binary chooses its process role:
  [Process model and main-process startup](../architecture/process-model-and-startup.md).
- Tests: `spec/api-utility-process-spec.ts`.
