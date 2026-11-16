---
type: concept
title: Node embedding, utility processes, and ASAR
description: How Electron cooperates with the Node event loop, hosts utility-process JavaScript, and makes ASAR paths available to selected filesystem and module operations.
tags: [node, event-loop, utility-process, asar]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T08:40:08.980Z
sources:
  - id: openwiki-source-7eeed5ef9467bffeed17e70c
    resource: repo://docs/tutorial/asar-archives.md
  - id: openwiki-source-f788662ecd080d1991e2a178
    resource: repo://lib/browser/api/utility-process.ts
  - id: openwiki-source-ef7c44300e1cb294b01c7304
    resource: repo://lib/common/init.ts
  - id: openwiki-source-fc70a27ce2ad9ad66fb961ef
    resource: repo://lib/node/asar-fs-wrapper.ts
  - id: openwiki-source-f0fd38de25eeb7a8f5bbd940
    resource: repo://lib/utility/init.ts
  - id: openwiki-source-d9f1d2383a518360722e4aba
    resource: repo://shell/app/electron_main_linux.cc
  - id: openwiki-source-b326c72eb64dde6d23fbe693
    resource: repo://shell/app/node_main.cc
  - id: openwiki-source-24b9fe87828b46683807734f
    resource: repo://shell/browser/api/electron_api_utility_process.cc
  - id: openwiki-source-a80d965312b6d4ace23f3bad
    resource: repo://shell/common/asar/archive.cc
  - id: openwiki-source-7a563f98407b944e8311fdf4
    resource: repo://shell/common/node_bindings.cc
generated: { by: "codex", at: "2026-11-16T08:40:08.980Z" }
---

# Node embedding, utility processes, and ASAR

Electron adapts Node execution to Chromium scheduling and packaging. A browser Node environment, a renderer preload, a utility process, and RunAsNode are distinct execution paths; reproducing a failure in one does not establish behavior in all of them.

## Cooperating event loops

[NodeBindings](../../shell/common/node_bindings.cc) starts a polling thread with a semaphore and a dummy libuv handle. The polling thread waits for libuv activity and wakes Chromium's task runner. On the owning thread, UvRunOnce enters the Node context, uses an explicit microtask scope, runs libuv with UV_RUN_NOWAIT, then releases the polling thread to continue. It returns without running libuv when navigation has already destroyed the Node environment.

[Common initialization](../../lib/common/init.ts) wraps process.nextTick, setImmediate, and Node timer functions to call process.activateUvLoop. This prevents queued callbacks or changed timer deadlines from waiting indefinitely for unrelated IO. Browser and utility processes also install the wrapped timeout/interval functions globally.

Browser startup has a separate JoinAppCode phase: it pumps UV_RUN_ONCE until app code signals completion, shutdown begins, or the loop stops. This connects asynchronous ESM entry loading to the [native startup handoff](../architecture/process-lifecycle.md). Investigate both this initial join and normal polling when diagnosing startup hangs.

RunAsNode enters [NodeMain](../../shell/app/node_main.cc), whose execution path loads a Node environment and calls Node's SpinEventLoop. Native executable selection is fuse-gated; this mode is not the same as enabling Node integration in a web page.

## Utility-process boundary

The main-process utilityProcess wrapper normalizes arguments and stdio before invoking the native fork binding. Native creation requires app readiness and launches a NodeService through Chromium's ServiceProcessHost. This is a useful source boundary for background JavaScript execution and child-process lifecycle reporting.

The wrapper supports inherited, ignored, or piped output; stdin must be ignored. It converts native output file descriptors into readable streams. On exit it emits the exit event and then clears the handle and output-stream references even if an event listener throws. After cleanup, kill returns false and message sends have no native handle to target.

Utility initialization restores the entry script in argv, installs common settings, and exposes a nonwritable process.parentPort. Adding the first message listener starts reception; removing the last pauses it. The startup script is loaded through Node's ESM entry loader, with failures forwarded to the uncaught-exception machinery.

Messages can include transferred MessagePortMain objects on the parent side; the wrapper unwraps those native ports before sending. Received ports on the utility side are wrapped again. See [IPC and ports](ipc.md) for the ownership model.

## ASAR as a virtual filesystem layer

[asar-fs-wrapper](../../lib/node/asar-fs-wrapper.ts) recognizes archive paths, caches native Archive objects, and adapts selected fs and module-loading operations. It also makes the archive helper available temporarily to browser package discovery.

Operations that need an actual filesystem path can use Archive::CopyFileOut. An unpacked entry resolves into the adjacent `.asar.unpacked` tree. Packed entries are extracted into cached temporary files; executable entries receive executable permissions on POSIX. The wrappers apply this path conversion to open, native addon loading, and other supported operations.

This is not a writable mounted filesystem. The [ASAR guide](../../docs/tutorial/asar-archives.md) documents read-only archives, inability to use an archive directory as cwd, synthetic stat information, and restrictions on executing binaries. Keep mutable application state outside the archive and ship required unpacked files alongside it.

`process.noAsar` disables wrapper path handling. The environment-based ELECTRON_NO_ASAR switch is honored here only outside browser and renderer processes. For raw archive access, the guide documents original-fs. When debugging packaged-only failures, compare archive paths, unpacked paths, and the native extraction branch before treating them as ordinary host files.

## Focused verification

[ASAR specs](../../spec/asar-spec.ts) exercise protocol access, workers, and fs operations. [Utility-process specs](../../spec/api-utility-process-spec.ts) cover construction, lifecycle, ESM, output streams, killing, and messaging. Node embedding changes also warrant the Node smoke runner described in [validation](../testing/validation.md). Packaging inputs and binary installation are covered by [distribution](../operations/distribution.md).
