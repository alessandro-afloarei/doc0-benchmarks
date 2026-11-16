---
title: "Node.js Environment"
---
## Overview

Electron embeds a Node.js environment in each process that runs Electron JavaScript: the browser process, the renderers with Node integration, the utility processes and worker threads. This page covers the three parts that make Node.js behave as Electron needs: the native bindings each process registers, the `process` properties Electron adds, and the TypeScript that changes Node.js's module loading and timers. The public modules that the environment exposes are described in [[Main Process Modules]].

Sources: [shell/common/node_bindings.cc:531-540](repo://shell/common/node_bindings.cc#L531-L540)

## Linked bindings

`NodeBindings` declares a `_register_` function for every native binding and calls them at startup. Each binding is named by a `V(...)` entry in one of several macro lists: a browser list, a common list, a renderer list, a utility list and a testing list.

Sources: [shell/common/node_bindings.cc:53-87](repo://shell/common/node_bindings.cc#L53-L87)

Sources: [shell/common/node_bindings.cc:89-96](repo://shell/common/node_bindings.cc#L89-L96)

Sources: [shell/common/node_bindings.cc:117-124](repo://shell/common/node_bindings.cc#L117-L124)

`RegisterBuiltinBindings` expands those lists by process type. The browser list is used only in the browser process, the renderer list only in renderers, and the utility list only in utility processes. The common list is registered everywhere. The call happens inside `Initialize`, before the Node.js environment is created.

Sources: [shell/common/node_bindings.cc:531-549](repo://shell/common/node_bindings.cc#L531-L549)

Sources: [shell/common/node_bindings.cc:587-600](repo://shell/common/node_bindings.cc#L587-L600)

## Process properties

`ElectronBindings` adds Electron's own members to Node's `process` object. `BindProcess` sets the members shared by all processes, such as `crash`, `hang`, `getCPUUsage` and `getSystemVersion`. It adds `getProcessMemoryInfo` only in the browser process.

Sources: [shell/common/api/electron_bindings.cc:43-70](repo://shell/common/api/electron_bindings.cc#L43-L70)

`BindTo` runs for the browser process once its environment exists. It calls `BindProcess`, then adds `takeHeapSnapshot`, `setFdLimit` on POSIX and `activateUvLoop`, which lets JavaScript wake the libuv loop that Chromium's loop drives.

Sources: [shell/common/api/electron_bindings.cc:72-84](repo://shell/common/api/electron_bindings.cc#L72-L84)

## Shared JavaScript init

`lib/common/init.ts` is loaded first by the browser and renderer inits. It wraps `process.nextTick`, `setImmediate` and the timer functions so that each call wakes the libuv loop, because Electron runs that loop only when a request arrives.

Sources: [lib/common/init.ts:14-35](repo://lib/common/init.ts#L14-L35)

Sources: [lib/common/init.ts:43-51](repo://lib/common/init.ts#L43-L51)

In the browser and utility processes, the wrapped timers also replace the global `setTimeout` and `setInterval`. The file leaves renderers out of this step, because their Node.js globals are deleted later in the renderer init.

Sources: [lib/common/init.ts:58-63](repo://lib/common/init.ts#L58-L63)

`makeElectronModule` inserts a fake module into Node's module cache for each name that refers to Electron: `electron`, `electron/common`, and the process-specific alias such as `electron/main`. `require` of any of these names returns the `electron` module. The resolver also maps them to the `electron` key, so the aliases share one module object.

Sources: [lib/common/init.ts:81-100](repo://lib/common/init.ts#L81-L100)

Sources: [lib/common/init.ts:102-119](repo://lib/common/init.ts#L102-L119)

## Node-side patches

`lib/node/init.ts` runs inside the Node.js environment itself. It makes the `fs` module read from ASAR archives, and it copies the `blink`-prefixed fetch globals to their normal names when Blink provides them.

Sources: [lib/node/init.ts:1-13](repo://lib/node/init.ts#L1-L13)

`child_process.fork` is wrapped so that a forked script runs with `ELECTRON_RUN_AS_NODE=1`. On macOS the wrapper also points `execPath` at the helper executable, so the child starts as plain Node.js.

Sources: [lib/node/init.ts:17-37](repo://lib/node/init.ts#L17-L37)

Module path lookup is limited to the app. `Module._nodeModulePaths` drops any search path outside the app's resources folder when the lookup starts inside the app.

Sources: [lib/node/init.ts:47-59](repo://lib/node/init.ts#L47-L59)
