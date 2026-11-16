---
title: "Utility Processes and Run-as-Node"
---
## Overview

Electron can run JavaScript outside a window in two ways. `utilityProcess.fork()` launches a separate process from the main process that runs a script with Node.js and a message channel back to its parent. `ELECTRON_RUN_AS_NODE` turns the whole binary into a plain Node.js interpreter, with none of Chromium started. Both reuse the same pieces as the main process, `NodeBindings` and a JavaScript bundle, but each starts from a different entry point. The shared mechanics are in [[Node.js and Chromium Event Loop Integration]].

Sources: [lib/browser/api/utility-process.ts:1-9](repo://lib/browser/api/utility-process.ts#L1-L9), [shell/app/electron_main_linux.cc:25-42](repo://shell/app/electron_main_linux.cc#L25-L42)

## Utility process: the parent side

`utilityProcess.fork(modulePath, args, options)` is `ForkUtilityProcess` in `lib/browser/api/utility-process.ts`. The constructor requires a module path, accepts `args` as optional (a plain object in that position is treated as `options`), and type-checks `execArgv`, `serviceName` and `cwd`. It normalises `stdio` into the three slots `ignore` for stdin and `inherit`, `ignore` or `pipe` for the other two; a `pipe` creates a `PassThrough` stream on the JavaScript side. Any value other than `ignore` for stdin is rejected.

Sources: [lib/browser/api/utility-process.ts:9-91](repo://lib/browser/api/utility-process.ts#L9-L91)

It then calls the native `_fork` binding with `{ options, modulePath, args }` and overrides the handle's `emit`. When the native object reports `stdout` or `stderr`, it wraps the file descriptor in a `Socket` and pipes it into the stream; on `exit` it detaches the streams. Other events are re-emitted on the wrapper. `postMessage` unwraps any `MessagePortMain` in the transfer list, `kill` forwards, and `pid` reads from the handle.

Sources: [lib/browser/api/utility-process.ts:93-152](repo://lib/browser/api/utility-process.ts#L93-L152)

In C++, `UtilityProcessWrapper::Create` throws if the app is not ready, requires an options object, and reads `modulePath`, `args`, `env`, `execArgv`, `serviceName`, `cwd`, `respondToAuthRequestsFromMainProcess` and the stdio modes into a `NodeServiceParams` struct. The returned wrapper pins itself so it is not garbage collected while the process runs.

Sources: [shell/browser/api/electron_api_utility_process.cc:438-518](repo://shell/browser/api/electron_api_utility_process.cc#L438-L518)

The constructor launches the process through `content::ServiceProcessHost::Launch` with a `NodeService` receiver, display name, extra command-line switches from `execArgv`, working directory, and environment. By default the child inherits the parent environment; it only clears it when `env` was given. `NodeService` is declared with `ServiceSandbox=kNoSandbox`, so these processes are unsandboxed.

Sources: [shell/browser/api/electron_api_utility_process.cc:155-195](repo://shell/browser/api/electron_api_utility_process.cc#L155-L195), [shell/services/node/public/mojom/node_service.mojom:8-31](repo://shell/services/node/public/mojom/node_service.mojom#L8-L31)

Communication uses a dedicated message pipe, not the service interface. The code's comment says this lets messages queue without blocking other interfaces. The wrapper creates a `MessagePortDescriptorPair`, keeps one port behind a `mojo::Connector` that delivers incoming messages, and sends the other in the params. It also creates a URL loader factory and host resolver from the browser's network context for the child, so `net` works in the child. Finally it calls `NodeService::Initialize`.

Sources: [shell/browser/api/electron_api_utility_process.cc:197-242](repo://shell/browser/api/electron_api_utility_process.cc#L197-L242)

When the process starts, `OnServiceProcessLaunch` records the pid, registers the wrapper in a global table, emits `stdout`/`stderr` descriptors if piped, and emits `spawn`. Exit is handled by `HandleTermination`, which runs only once: it removes the pid, closes the port, and on POSIX converts `SIGTERM` or `SIGKILL` exit codes into 0 when the wrapper itself killed the process, since that counts as a graceful shutdown. It then emits `exit` and unpins. `kill` terminates the process by pid, and `Shutdown` resets the remote and terminates directly; `ElectronBrowserMainParts` calls `Shutdown` for each utility process at the end of the run so `exit` events still fire: see [[Process Startup and Main Process Boot]].

Sources: [shell/browser/api/electron_api_utility_process.cc:244-330](repo://shell/browser/api/electron_api_utility_process.cc#L244-L330), [shell/browser/api/electron_api_utility_process.cc:386-396](repo://shell/browser/api/electron_api_utility_process.cc#L386-L396), [shell/browser/electron_browser_main_parts.cc:571-591](repo://shell/browser/electron_browser_main_parts.cc#L571-L591)

## Utility process: the child side

In the child, `NodeService::Initialize` ignores a second call, binds the client remote, starts the `ParentPort` with the port from params, and installs the URL loader bundle. It creates a `JavascriptEnvironment` and initialises `NodeBindings` for `kUtility`, prepends the program path to `args` so `process.argv0` works, and creates the environment with the user's `args` and `exec_args`.

Sources: [shell/services/node/node_service.cc:88-150](repo://shell/services/node/node_service.cc#L88-L150)

It then installs a process-exit handler that closes the parent port, destroys the microtask runner and resets the service receiver with the reason `process_exit_termination`, which is the string the parent's disconnect handler looks for. The unhandled-rejection mode is set to `warn-with-error-code`, Electron's `process` extras are bound, and the entry script path is stored on `process` as the hidden value `_serviceStartupScript`. `LoadEnvironment` runs `electron/js2c/utility_init`, then the embed thread starts and polling begins.

Sources: [shell/services/node/node_service.cc:150-196](repo://shell/services/node/node_service.cc#L150-L196), [shell/browser/api/electron_api_utility_process.cc:289-297](repo://shell/browser/api/electron_api_utility_process.cc#L289-L297)

The init script is `lib/utility/init.ts`. It reads `_serviceStartupScript`, puts it back into `process.argv`, loads common init, sets the event-emitter prototype, and defines a read-only `process.parentPort`. `ParentPort` wraps a native port from `createParentPort`: its `emit` converts incoming ports into `MessagePortMain`s, and `start` and `pause` follow the `message` listener count, so the port only delivers while someone listens. The script then imports the entry script through Node's ESM loader, and any import error is passed to Node's `triggerUncaughtException`.

Sources: [lib/utility/init.ts:1-50](repo://lib/utility/init.ts#L1-L50), [lib/utility/parent-port.ts:1-32](repo://lib/utility/parent-port.ts#L1-L32)

Only a few Electron modules exist in a utility process. The utility module list contains `net` and `systemPreferences`, and the process-type list in `NodeBindings` registers only the common and utility bindings there: see [[Exposing Native APIs to JavaScript]].

Sources: [lib/utility/api/module-list.ts:1-5](repo://lib/utility/api/module-list.ts#L1-L5), [shell/common/node_bindings.cc:106-112](repo://shell/common/node_bindings.cc#L106-L112), [shell/common/node_bindings.cc:531-547](repo://shell/common/node_bindings.cc#L531-L547)

## Run-as-Node

`main()` decides before Chromium starts. If the run-as-node fuse is enabled and the `ELECTRON_RUN_AS_NODE` environment variable is set to a non-empty value, it initialises ICU and calls `electron::NodeMain()` instead of `ContentMain`. The same check appears in the macOS and Windows entry points. The fuse is described in [[Fuses and Binary-Level Feature Switches]].

Sources: [shell/app/electron_main_linux.cc:34-42](repo://shell/app/electron_main_linux.cc#L34-L42), [shell/app/electron_main_mac.cc:54-54](repo://shell/app/electron_main_mac.cc#L54-L54), [shell/app/electron_main_win.cc:161-161](repo://shell/app/electron_main_win.cc#L161-L161)

```cpp
if (electron::fuses::IsRunAsNodeEnabled() && IsEnvSet(electron::kRunAsNode)) {
  base::i18n::InitializeICU();
  base::AtExitManager atexit_manager;
  return electron::NodeMain();
}
```

Sources: [shell/app/electron_main_linux.cc:18-42](repo://shell/app/electron_main_linux.cc#L18-L42), [shell/common/electron_constants.h:24-24](repo://shell/common/electron_constants.h#L24-L24), [shell/app/electron_main_mac.cc:54-54](repo://shell/app/electron_main_mac.cc#L54-L54), [shell/app/electron_main_win.cc:161-161](repo://shell/app/electron_main_win.cc#L161-L161)

`NodeMain` hardens the process before running anything. If the `NODE_OPTIONS` fuse is off it unsets `NODE_OPTIONS` and `NODE_EXTRA_CA_CERTS`. On macOS, when the parent process is not signed the same as this app, it removes `NODE_OPTIONS` and `NODE_REPL_EXTERNAL_MODULE`; the comment explains that otherwise another app could run a sandboxed Electron app's binary in node mode with `NODE_OPTIONS` to inject scripts and bypass the sandbox's argument restrictions. `ExitIfContainsDisallowedFlags` rejects `--enable-fips`, `--force-fips`, `--openssl-config`, `--use-bundled-ca` and `--use-openssl-ca`, exiting with code 9 as Node does for bad flags.

Sources: [shell/app/electron_main_linux.cc:25-42](repo://shell/app/electron_main_linux.cc#L25-L42), [shell/app/node_main.cc:62-104](repo://shell/app/node_main.cc#L62-L104), [shell/app/node_main.cc:123-150](repo://shell/app/node_main.cc#L123-L150)

The rest is a miniature of the browser startup. It restores crashpad descriptors on Linux, feeds `gin::PerIsolateData` a libuv-backed task runner, initialises a feature list, registers built-in bindings, calls `node::InitializeOncePerProcess` without V8 or the Node platform, loads the V8 snapshot and starts a thread pool, then creates a `JavascriptEnvironment`, a Node environment, `process.crash` and a `process.crashReporter` with parameter helpers. It runs `node::LoadEnvironment` with the same `OnNodePreload` hook as the main process and spins the event loop itself with `node::SpinEventLoop`, returning its exit code, because there is no Chromium message loop to share.

Sources: [shell/app/node_main.cc:156-206](repo://shell/app/node_main.cc#L156-L206), [shell/app/node_main.cc:228-300](repo://shell/app/node_main.cc#L228-L300)

The Node-side of this is also how `child_process.fork` works inside an Electron app: `lib/node/init.ts` wraps `fork` so the child's environment gets `ELECTRON_RUN_AS_NODE=1`, and on macOS the child runs in the helper executable.

Sources: [lib/node/init.ts:15-41](repo://lib/node/init.ts#L15-L41)
