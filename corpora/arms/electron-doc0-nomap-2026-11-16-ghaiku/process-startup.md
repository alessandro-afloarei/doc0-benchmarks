---
title: "Process Startup"
---
## Overview

Every Electron process starts in the native executable, which decides whether to run as Node.js or as a Chromium process. For the browser process, the native code starts Chromium's content layer, then Node.js with the browser init script, and that script loads the app's `package.json` and `main` file. This page follows the browser process from `main()` to the app's first line of JavaScript. Renderer startup is on [[Renderer Startup and Realms]].

Sources: [shell/app/electron_main_linux.cc:29-44](repo://shell/app/electron_main_linux.cc#L29-L44)

`main` first checks the `RunAsNode` fuse together with the `ELECTRON_RUN_AS_NODE` environment variable. When both are set, the executable skips Chromium and runs `NodeMain`, so the same binary works as a plain Node.js interpreter.

Sources: [shell/app/electron_main_linux.cc:36-41](repo://shell/app/electron_main_linux.cc#L36-L41)

Otherwise `main` creates an `ElectronMainDelegate` and passes it to `content::ContentMain`, which calls the delegate's startup hooks in order.

Sources: [shell/app/electron_main_linux.cc:43-44](repo://shell/app/electron_main_linux.cc#L43-L44)

## Delegate hooks

`BasicStartupComplete` runs before any Chromium subsystem starts. It reads the `ELECTRON_ENABLE_STACK_DUMPING` and `ELECTRON_DISABLE_SANDBOX` environment variables, which set the stack-dump flag and the `--no-sandbox` switch, and it registers the path providers that let later code find Electron's resource files.

Sources: [shell/app/electron_main_delegate.cc:264-291](repo://shell/app/electron_main_delegate.cc#L264-L291)

`PreBrowserMain` runs in the browser process. It initializes the feature list before the service manager reads it, starts Mojo core, and on Linux reads the XDG activation token from the environment.

Sources: [shell/app/electron_main_delegate.cc:418-434](repo://shell/app/electron_main_delegate.cc#L418-L434)

## Starting Node.js

`NodeBindings::Initialize` registers Electron's builtin bindings before it starts Node.js. The init script name is built from the process type, so the browser process runs `electron/js2c/browser_init`, a renderer runs `electron/js2c/renderer_init`, and so on.

Sources: [shell/common/node_bindings.cc:587-600](repo://shell/common/node_bindings.cc#L587-L600), [shell/common/node_bindings.cc:702-704](repo://shell/common/node_bindings.cc#L702-L704)

During Node's preload hook, `OnNodePreload`, the native code runs `lib/node/init.ts` through `CompileAndCall`. That script, whose bundling is covered on [[JavaScript Module Loading]], wraps `fs` for ASAR support, hooks `child_process.fork` so a forked child runs with `ELECTRON_RUN_AS_NODE=1`, and limits module search paths to the app's resources folder.

Sources: [shell/common/node_bindings.cc:995-996](repo://shell/common/node_bindings.cc#L995-L996), [shell/common/node_bindings.cc:1019-1021](repo://shell/common/node_bindings.cc#L1019-L1021), [lib/node/init.ts:3-4](repo://lib/node/init.ts#L3-L4), [lib/node/init.ts:15-40](repo://lib/node/init.ts#L15-L40), [lib/node/init.ts:48-59](repo://lib/node/init.ts#L48-L59)

## The browser init script

`lib/browser/init.ts` runs as the first script of the browser process. It removes the injected script path from `process.argv` and loads the common init, which patches timers and the Node module aliases.

Sources: [lib/browser/init.ts:14-17](repo://lib/browser/init.ts#L14-L17)

The script installs an `uncaughtException` handler that shows the error in a dialog, unless the app has its own handler. It then maps `process.exit` to `app.exit`, so an exit goes through the quit path.

Sources: [lib/browser/init.ts:22-37](repo://lib/browser/init.ts#L22-L37), [lib/browser/init.ts:74](repo://lib/browser/init.ts#L74)

## Finding the app

The native code passes the candidate search paths to the script as hidden values. The script tries each one in order under the resources path, and when only ASAR archives are allowed it skips any path that is not an archive. The first path whose `package.json` loads is the app.

Sources: [lib/browser/init.ts:86-101](repo://lib/browser/init.ts#L86-L101)

If no path loads, the script exits the process with status 1 and throws `Unable to find a valid app`. Otherwise the package's `version`, `productName` or `name`, and `desktopName` fields set the app's identity, and the app path is set to the package folder.

Sources: [lib/browser/init.ts:110-115](repo://lib/browser/init.ts#L110-L115), [lib/browser/init.ts:117-141](repo://lib/browser/init.ts#L117-L141)

The script then loads the browser-side API modules that must exist before `app` is ready, and it sets the default application menu when `will-finish-launching` fires.

Sources: [lib/browser/init.ts:143-163](repo://lib/browser/init.ts#L143-L163), [lib/browser/init.ts:199](repo://lib/browser/init.ts#L199)

## Loading `main`

The script reads `main` from the package, defaulting to `index.js`. A package with `"type": "module"` (or a `.mjs` entry) loads through Node's ESM loader, and everything else goes through `Module._load`. In the ESM case `appCodeLoaded` is called after the import finishes, so a thrown error is reported as an uncaught exception.

Sources: [lib/browser/init.ts:163](repo://lib/browser/init.ts#L163), [lib/browser/init.ts:200-221](repo://lib/browser/init.ts#L200-L221)

If the package cannot be found at all, the script prints a message and calls `appCodeLoaded` so the process does not hang.

Sources: [lib/browser/init.ts:222-226](repo://lib/browser/init.ts#L222-L226)
