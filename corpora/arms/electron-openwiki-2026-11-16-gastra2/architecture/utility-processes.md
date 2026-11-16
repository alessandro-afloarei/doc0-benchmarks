---
type: architecture
title: Utility processes and Node services
description: How utilityProcess.fork launches a Chromium-hosted Node service, transfers messages, supplies networking and coordinates termination.
tags: [utility-process, node, messaging, lifecycle]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T18:01:04.581Z
sources:
  - id: openwiki-source-f788662ecd080d1991e2a178
    resource: repo://lib/browser/api/utility-process.ts
  - id: openwiki-source-f0fd38de25eeb7a8f5bbd940
    resource: repo://lib/utility/init.ts
  - id: openwiki-source-24b9fe87828b46683807734f
    resource: repo://shell/browser/api/electron_api_utility_process.cc
  - id: openwiki-source-b3fce888fb7314f90ce04e64
    resource: repo://shell/browser/electron_browser_main_parts.cc
  - id: openwiki-source-48c2f19b8838015a32bac539
    resource: repo://shell/services/node/node_service.cc
  - id: openwiki-source-bc373bb2272757b7d01f0db8
    resource: repo://shell/services/node/public/mojom/node_service.mojom
generated: { by: "codex", at: "2026-11-16T18:01:04.581Z" }
---

# Utility processes and Node services

`utilityProcess.fork` runs a Node entry script in a Chromium service process. The main process owns the public wrapper and launch configuration; `shell/services/node/node_service.cc` owns the child's Node environment. The service's Mojo declaration specifies `kNoSandbox`: this is a process separation mechanism, not a sandbox for untrusted scripts.

## Launch and initialization

Call `fork` after application readiness. The native constructor rejects earlier calls. The TypeScript wrapper validates the entry, arguments and options before forwarding to `_fork`; stdout/stderr support `inherit`, `ignore` and `pipe`, while stdin must be ignored. Defaults are ignored stdin and inherited stdout/stderr.

The native wrapper launches `NodeService` through `ServiceProcessHost`, passing script arguments, Node flags, service display name, working directory and environment. In this implementation an empty environment map inherits the parent environment; a nonempty map clears the inherited environment before applying entries. The launch callback records the PID, connects output streams and emits `spawn`.

Before loading user code, the child initializes its parent message port and network bundle, creates the JavaScript and Node environments, installs an exit handler, and creates the microtask runner. Only then does it load the utility bootstrap and start polling libuv. This order lets an entry-script exception exit cleanly with the necessary runtime infrastructure already installed.

`lib/utility/init.ts` restores the entry script in `process.argv`, installs common initialization and a read-only `process.parentPort`, and imports the entry through Node's ESM loader. Import errors are raised through Node's uncaught-exception machinery. Utility-specific API exports include `net` and `systemPreferences`; use the utility export table rather than assuming every browser API is available.

## Message flow

```mermaid
flowchart LR
  F[UtilityProcess.postMessage] --> P[Dedicated message pipe]
  P --> C[process.parentPort message event]
  C --> R[process.parentPort.postMessage]
  R --> E[UtilityProcess message event]
```

The parent message pipe is separate from the service-control interface so queued application messages do not block service initialization/control. Adding the first child `message` listener starts delivery; removing the last pauses it. The parent can transfer `MessagePortMain` endpoints, and the child wrapper converts received native endpoints into `MessagePortMain` instances. This supports a direct channel to another participant such as a renderer after the initial setup. See [IPC and message ports](ipc-and-message-ports.md) for transfer ownership.

## Networking boundary

Launch obtains a URL loader factory and host resolver from the browser's **system network context**, then supplies them to the child through `NodeServiceParams`. The factory is marked trusted and has ORB disabled. `respondToAuthRequestsFromMainProcess` controls attaching a network observer. This differs from a browser `net.fetch` call delegated to `session.defaultSession`; trace the utility's bundle when investigating authentication or session assumptions.

## Termination and cleanup

The child's process-exit handler closes its parent port, destroys its microtask runner, and disconnects the service with an exit-code reason before invoking Node's default exit handler. The parent also observes normal termination and crashes. `HandleTermination` guards against duplicate notifications, removes the PID mapping, closes messaging and emits `exit` once. For a child killed through the wrapper, POSIX SIGTERM/SIGKILL termination codes are normalized to zero.

After the JavaScript `exit` listener runs, a `finally` block clears the native handle and stdout/stderr listeners and references. `pid` subsequently becomes undefined, and `kill()` returns false if the handle is already gone. Browser shutdown explicitly stops Electron Node services before stopping the browser Node environment so those exit events can still run; see [runtime teardown](runtime-startup.md#quit-exit-and-destruction).

## Regression targets

`spec/api-utility-process-spec.ts` covers missing scripts, crashes, ESM exceptions, `process.exit`, PID lifecycle, stdio, queued messages, transferred renderer channels, custom environments and working directories. The fixtures under `spec/fixtures/api/utility-process/` isolate those child behaviors. Consult [contributor validation](../testing/contributor-validation.md) for running a focused subset.
