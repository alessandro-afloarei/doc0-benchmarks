---
title: "Application Startup"
---
## Overview

Startup has four steps. The native `main()` picks the process and the content delegate. The browser process creates a Node.js environment with the browser bindings. Node.js runs the browser init bundle, which finds the app's `package.json` and loads its main script. The app then creates its windows. This page follows those steps. The Node.js bindings are described in [[Node.js Environment]], and the window the app creates in [[Windows and Web Contents]].

Sources: [shell/app/electron_main_linux.cc:29-43](repo://shell/app/electron_main_linux.cc#L29-L43)

## Native entry point

`main()` initialises the command line and then checks the RunAsNode fuse together with the `ELECTRON_RUN_AS_NODE` variable. If both are set, the binary runs as plain Node.js and returns from `NodeMain()`. Otherwise it creates an `ElectronMainDelegate` and passes it to `content::ContentMain`, which starts Chromium.

Sources: [shell/app/electron_main_linux.cc:29-43](repo://shell/app/electron_main_linux.cc#L29-L43)

The Windows and macOS entry points make the same RunAsNode check before starting Chromium.

Sources: [shell/app/electron_main_win.cc:158-165](repo://shell/app/electron_main_win.cc#L158-L165)

Sources: [shell/app/electron_main_mac.cc:50-60](repo://shell/app/electron_main_mac.cc#L50-L60)

## Browser main parts

Chromium calls `ElectronMainDelegate::PreBrowserMain`, which initialises the feature list and Mojo core before any browser code runs.

Sources: [shell/app/electron_main_delegate.cc:418-435](repo://shell/app/electron_main_delegate.cc#L418-L435)

The `ElectronBrowserMainParts` constructor creates the `NodeBindings` for the browser environment and the `ElectronBindings` that run on its libuv loop. Browser setup then creates the `JavascriptEnvironment` and calls `Initialize` on the bindings. It also creates the Node.js environment and binds the Electron extras onto `process`.

Sources: [shell/browser/electron_browser_main_parts.cc:172-182](repo://shell/browser/electron_browser_main_parts.cc#L172-L182)

Sources: [shell/browser/electron_browser_main_parts.cc:232-249](repo://shell/browser/electron_browser_main_parts.cc#L232-L249)

`PreMainMessageLoopRun` starts the Node.js embed thread and polling. On platforms other than macOS it then calls `WillFinishLaunching` and `DidFinishLaunching` on the `Browser` object, which is where `app` emits its launch events; on macOS that call is made from the application delegate.

Sources: [shell/browser/electron_browser_main_parts.cc:425-479](repo://shell/browser/electron_browser_main_parts.cc#L425-L479)

## Loading the init bundle

`NodeBindings::CreateEnvironment` gives the process a set of search paths for the app. The app is looked for as `app.asar`, then `app`, then `default_app.asar`. When the OnlyLoadAppFromAsar fuse is on, only the `app.asar` entry is kept.

Sources: [shell/common/node_bindings.cc:681-692](repo://shell/common/node_bindings.cc#L681-L692)

The init script name is built from the process type, so the browser process runs `electron/js2c/browser_init`. Other process types use their own `_init` bundle the same way.

Sources: [shell/common/node_bindings.cc:702-702](repo://shell/common/node_bindings.cc#L702-L702)

`LoadEnvironment` hands Node.js the `OnNodePreload` callback. That callback runs `lib/node/init.ts` with the `process` and `require` objects, which sets up the Node.js side of the environment.

Sources: [shell/common/node_bindings.cc:855-858](repo://shell/common/node_bindings.cc#L855-L858)

Sources: [shell/common/node_bindings.cc:1014-1021](repo://shell/common/node_bindings.cc#L1014-L1021)

## Loading the app

`lib/browser/init.ts` runs in the bundle. It first removes the `--` argument that was inserted for Node, then loads the common init. It installs the uncaught-exception handler that shows an error dialog, and connects the `quit` event to `process.exit`.

Sources: [lib/browser/init.ts:14-17](repo://lib/browser/init.ts#L14-L17)

Sources: [lib/browser/init.ts:22-45](repo://lib/browser/init.ts#L22-L45)

It then loads the RPC server and the guest view manager, the two modules that answer the renderers' internal IPC requests.

Sources: [lib/browser/init.ts:77-80](repo://lib/browser/init.ts#L77-L80)

Next it reads the app's `package.json` from each search path in turn. The first path that loads wins. If none loads, the process exits with an error.

Sources: [lib/browser/init.ts:86-110](repo://lib/browser/init.ts#L86-L110)

From that file the init code sets the app's version, name and desktop name, the V8 flags, and the app path. It then hooks `window-all-closed` so the app quits when its last window closes, and installs the default menu on `will-finish-launching`.

Sources: [lib/browser/init.ts:116-141](repo://lib/browser/init.ts#L116-L141)

Sources: [lib/browser/init.ts:187-199](repo://lib/browser/init.ts#L187-L199)

Last, the main script runs. Packages with `"type": "module"` or a `.mjs` entry use the ESM loader. Everything else goes through `Module._load`. `appCodeLoaded` is called once the app's code has run, so the native side knows the app has started.

Sources: [lib/browser/init.ts:163-163](repo://lib/browser/init.ts#L163-L163)

Sources: [lib/browser/init.ts:207-221](repo://lib/browser/init.ts#L207-L221)

## Fuses

Fuses are on-or-off switches compiled into the binary. `build/fuses/fuses.json5` lists eight of them, each set to `"1"` (on) or `"0"` (off), and a removed fuse is marked `r`. The startup-relevant ones are `run_as_node`, `node_options`, `node_cli_inspect`, `embedded_asar_integrity_validation` and `only_load_app_from_asar`.

Sources: [build/fuses/fuses.json5:1-13](repo://build/fuses/fuses.json5#L1-L13)

`build/fuses/build.py` reads that file and generates the `electron/fuses.h` header with one `Is…Enabled()` accessor per fuse. The native code calls those accessors at the point where each switch applies.

Sources: [build/fuses/build.py:11-27](repo://build/fuses/build.py#L11-L27)

Sources: [build/fuses/build.py:51-72](repo://build/fuses/build.py#L51-L72)

The RunAsNode check is in `main()`. The embedded-ASAR integrity check runs in `ValidateV8Snapshot`, and the NodeOptions and CLI inspect checks run inside `NodeBindings`.

Sources: [shell/app/electron_main_delegate.cc:216-222](repo://shell/app/electron_main_delegate.cc#L216-L222)

Sources: [shell/common/node_bindings.cc:385-424](repo://shell/common/node_bindings.cc#L385-L424)
