---
title: "JavaScript Module Loading"
---
## Overview

The `electron` module that app code imports is not a file on disk. Each process type builds an exports object from a list of module names and loaders, and the init scripts make the `electron/*` names resolve to it. The sources in `lib/` are compiled into one bundle per process type with webpack, and that bundle is embedded in the binary. This page covers how the export list is built and how the bundles are configured. The browser init script that reads these exports at startup is on [[Process Startup]], and the behaviour of each API is on the page for its area.

Sources: [lib/common/init.ts:92-100](repo://lib/common/init.ts#L92-L100), [build/webpack/webpack.config.base.js:109-127](repo://build/webpack/webpack.config.base.js#L109-L127)

## Export lists

Each process type has an `api/exports/electron.ts` file that creates an empty exports object and attaches module lists to it. The browser entry attaches the common list and then the browser list, so the browser's `electron` exports are the union of the two. The renderer entry does the same with the renderer list.

Sources: [lib/browser/api/exports/electron.ts:1-8](repo://lib/browser/api/exports/electron.ts#L1-L8), [lib/renderer/api/exports/electron.ts:1-8](repo://lib/renderer/api/exports/electron.ts#L1-L8)

Each list is an array of `{ name, loader }` entries. The browser list is alphabetical, and its header comment says that a change to it also needs a matching change to the module-keys file. The common list holds the two modules that every process type exposes: `nativeImage` and `shell`.

Sources: [lib/browser/api/module-list.ts:1-6](repo://lib/browser/api/module-list.ts#L1-L6), [lib/common/api/module-list.ts:1-5](repo://lib/common/api/module-list.ts#L1-L5), [lib/renderer/api/module-list.ts:1-8](repo://lib/renderer/api/module-list.ts#L1-L8)

`defineProperties` turns each entry into an enumerable getter. The getter runs the loader the first time the property is read, and if the loaded module is an ES module with a default export it returns that default. A module that is never read is never loaded, which keeps the startup cost of rarely used APIs low.

Sources: [lib/common/define-properties.ts:1-17](repo://lib/common/define-properties.ts#L1-L17)

## Resolving names

`makeElectronModule` puts a fake module into Node's module cache under the names `electron`, `electron/common`, and the name for the current process type: `electron/main` in the browser, `electron/renderer` in a renderer, and `electron/utility` in a utility process. Each fake module's `exports` property is a getter that returns the real `electron` module.

Sources: [lib/common/init.ts:80-100](repo://lib/common/init.ts#L80-L100)

The resolver override maps every name in the `electron` set to the bare name `electron`, so the cache lookup always finds the fake module. The names exist only for TypeScript: `electron/main` lists browser types and `electron/renderer` lists renderer types, but at run time all of them are the same object.

Sources: [lib/common/init.ts:102-119](repo://lib/common/init.ts#L102-L119)

## Bundling

Each process type has a webpack config that sets its entry point to `lib/<target>/init.ts`, and a shared base config builds the bundle. The base config aliases `@electron/internal` to `lib/`, and it aliases each `electron` name to the process's exports file. The worker bundle sets `loadElectronFromAlternateTarget` to `renderer`, so its `electron` alias points at the renderer exports file.

Sources: [build/webpack/webpack.config.base.js:28-34](repo://build/webpack/webpack.config.base.js#L28-L34), [build/webpack/webpack.config.base.js:117-127](repo://build/webpack/webpack.config.base.js#L117-L127), [build/webpack/webpack.config.worker.js:1-4](repo://build/webpack/webpack.config.worker.js#L1-L4)

The base config also adds `ProvidePlugin` entries when a process has deleted its Node globals. That lets bundled code get `process`, `global` and `Buffer` from `lib/common/webpack-provider.ts`, which takes them from the saved global object before the page deletes them.

Sources: [build/webpack/webpack.config.base.js:63-70](repo://build/webpack/webpack.config.base.js#L63-L70), [lib/common/webpack-provider.ts:1-18](repo://lib/common/webpack-provider.ts#L1-L18)

The base config can also wrap the whole bundle in a `try` block that logs the bundle's name and the error when the script fails.

Sources: [build/webpack/webpack.config.base.js:98-107](repo://build/webpack/webpack.config.base.js#L98-L107)

The GN file names the output for each bundle. The browser bundle is written to `js2c/browser_init.js`, and the renderer bundle to `js2c/renderer_init.js`. These are the names the native side looks up when it runs `electron/js2c/<process>_init`. The GN rule that runs webpack for each bundle is described on [[Build System]].

Sources: [BUILD.gn:165-172](repo://BUILD.gn#L165-L172), [BUILD.gn:174-181](repo://BUILD.gn#L174-L181)
