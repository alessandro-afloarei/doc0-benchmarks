---
title: "Module Loading and Linked Bindings"
---
## Overview

The `electron` module is not one file. Each process type has its own `exports/electron.ts` that assembles an object from lists of lazy module loaders, and almost every module in those lists is a thin TypeScript wrapper over a native binding that C++ registered under a name like `electron_browser_dialog`. This page follows that path from `require('electron')` to a native function, using `dialog` as the worked example. The C++ toolkit used inside a binding is in [[Gin Helpers, Converters and Wrappables]]; the bundles that contain these files are in [[Process Types and JavaScript Bootstraps]].

Sources: [lib/browser/api/exports/electron.ts:1-8](repo://lib/browser/api/exports/electron.ts#L1-L8), [lib/browser/api/dialog.ts:1-4](repo://lib/browser/api/dialog.ts#L1-L4)

## Assembling the electron object

The main-process entry builds `module.exports` as an empty object and fills it from two lists, the common modules and the browser modules, with `defineProperties`.

Sources: [lib/browser/api/exports/electron.ts:1-8](repo://lib/browser/api/exports/electron.ts#L1-L8)

```ts
module.exports = {};

defineProperties(module.exports, commonModuleList);
defineProperties(module.exports, browserModuleList);
```

Sources: [lib/browser/api/exports/electron.ts:5-8](repo://lib/browser/api/exports/electron.ts#L5-L8)

`defineProperties` creates one enumerable getter per list entry. The getter calls the entry's `loader`, so a module's file is only `require`d the first time the property is read. If the loaded value is an ES module with a default export, the default is returned instead.

Sources: [lib/common/define-properties.ts:1-17](repo://lib/common/define-properties.ts#L1-L17)

Each list is an array of `{ name, loader }` entries kept alphabetically sorted, with a note that changing one also requires updating the module-keys file. The browser list holds `app`, `BrowserWindow`, `dialog`, `ipcMain`, `Menu`, `session`, `Tray`, `webContents` and the rest of the main-process API, each loading `./<file>` lazily.

Sources: [lib/browser/api/module-list.ts:1-43](repo://lib/browser/api/module-list.ts#L1-L43)

The other process types use the same recipe with different lists:

Sources: [lib/renderer/api/exports/electron.ts:1-8](repo://lib/renderer/api/exports/electron.ts#L1-L8)

| Process | Exports file | Lists |
| --- | --- | --- |
| Main | `lib/browser/api/exports/electron.ts` | common + browser |
| Renderer, worker | `lib/renderer/api/exports/electron.ts` | common + renderer |
| Utility | `lib/utility/api/exports/electron.ts` | utility (`net`, `systemPreferences`) |

Sources: [lib/renderer/api/exports/electron.ts:1-8](repo://lib/renderer/api/exports/electron.ts#L1-L8), [lib/utility/api/exports/electron.ts:1-6](repo://lib/utility/api/exports/electron.ts#L1-L6), [lib/common/api/module-list.ts:1-5](repo://lib/common/api/module-list.ts#L1-L5), [lib/renderer/api/module-list.ts:1-9](repo://lib/renderer/api/module-list.ts#L1-L9), [lib/utility/api/module-list.ts:1-5](repo://lib/utility/api/module-list.ts#L1-L5)

Common modules (`nativeImage`, `shell`) appear in both main and renderer; `clipboard` is listed in both the browser and renderer lists, each with its own file.

Sources: [lib/common/api/module-list.ts:2-5](repo://lib/common/api/module-list.ts#L2-L5), [lib/browser/api/module-list.ts:10](repo://lib/browser/api/module-list.ts#L10-L10), [lib/renderer/api/module-list.ts:3](repo://lib/renderer/api/module-list.ts#L3-L3)

Inside the bundles, webpack aliases `electron`, `electron/main`, `electron/renderer`, `electron/common` and `electron/utility` to the exports file of the bundle's target, so internal code can simply `import { app } from 'electron/main'`. For application code, a patch to Node makes `electron` loadable through the ESM loader (`import { app } from 'electron'`), by adding an `electron:` URL scheme and an `electron` module format.

Sources: [build/webpack/webpack.config.base.js:117-127](repo://build/webpack/webpack.config.base.js#L117-L127), [patches/node/fix_expose_the_built-in_electron_module_via_the_esm_loader.patch:4-17](repo://patches/node/fix_expose_the_built-in_electron_module_via_the_esm_loader.patch#L4-L17), [patches/node/fix_expose_the_built-in_electron_module_via_the_esm_loader.patch:87-100](repo://patches/node/fix_expose_the_built-in_electron_module_via_the_esm_loader.patch#L87-L100)

## Linked bindings: the JavaScript side

A wrapper reaches native code with `process._linkedBinding(name)`. `dialog.ts` fetches `electron_browser_dialog` once at the top of the file, validates and normalizes its arguments in TypeScript (type checks, bit flags for dialog properties, defaults for missing options), and then calls the binding.

Sources: [lib/browser/api/dialog.ts:4-33](repo://lib/browser/api/dialog.ts#L4-L33), [lib/browser/api/dialog.ts:76-112](repo://lib/browser/api/dialog.ts#L76-L112)

```ts
const dialogBinding = process._linkedBinding('electron_browser_dialog');
```

Sources: [lib/browser/api/dialog.ts:4](repo://lib/browser/api/dialog.ts#L4-L4)

For example `saveDialog` rejects a non-string `title` with a `TypeError`, folds the `properties` array into a bit mask with `setupSaveDialogProperties`, builds a `settings` object, and ends with `sync ? dialogBinding.showSaveDialogSync(settings) : dialogBinding.showSaveDialog(settings)`.

Sources: [lib/browser/api/dialog.ts:6-12](repo://lib/browser/api/dialog.ts#L6-L12), [lib/browser/api/dialog.ts:76-112](repo://lib/browser/api/dialog.ts#L76-L112)

TypeScript knows what each binding returns through overloads of `_linkedBinding` in `typings/internal-ambient.d.ts`, for example `electron_common_clipboard` returns `Electron.Clipboard`.

Sources: [typings/internal-ambient.d.ts:219-222](repo://typings/internal-ambient.d.ts#L219-L222)

## Linked bindings: the native side

On the C++ side every binding file ends with a registration macro. `electron_api_dialog.cc` defines an `Initialize` function that receives the binding's `exports` object, wraps it in a `gin_helper::Dictionary` and attaches native functions with `SetMethod`; platform-specific entries sit behind `BUILDFLAG` guards (`showCertificateTrustDialog` only on macOS and Windows). The last line registers it:

Sources: [shell/browser/api/electron_api_dialog.cc:89-111](repo://shell/browser/api/electron_api_dialog.cc#L89-L111)

```cpp
NODE_LINKED_BINDING_CONTEXT_AWARE(electron_browser_dialog, Initialize)
```

Sources: [shell/browser/api/electron_api_dialog.cc:89-111](repo://shell/browser/api/electron_api_dialog.cc#L89-L111)

`NODE_LINKED_BINDING_CONTEXT_AWARE` is defined in `node_includes.h` as Node's context-aware C++ binding macro with the `NM_F_LINKED` flag. A comment explains the purpose: it is an alternative to `__attribute__((constructor))` that allows bindings to be registered explicitly rather than at load time.

Sources: [shell/common/node_includes.h:35-39](repo://shell/common/node_includes.h#L35-L39)

The explicit registration happens in `NodeBindings::RegisterBuiltinBindings`. `node_bindings.cc` forward-declares a `_register_<modname>` function for every name in the `ELECTRON_*_BINDINGS` lists, and `RegisterBuiltinBindings` calls them: the browser list only in the browser process, the common list everywhere, the renderer and utility lists in their processes. A binding that is not in its process's list is therefore not available to `process._linkedBinding` there.

Sources: [shell/common/node_bindings.cc:115-128](repo://shell/common/node_bindings.cc#L115-L128), [shell/common/node_bindings.cc:531-547](repo://shell/common/node_bindings.cc#L531-L547)

> [!NOTE]
> Sandboxed renderers have no Node, so `sandboxed_renderer/pre-init.ts` sets `process._linkedBinding = binding.get`, a getter that C++ passes into the bundle, instead of Node's own function.

Sources: [lib/sandboxed_renderer/pre-init.ts:10-11](repo://lib/sandboxed_renderer/pre-init.ts#L10-L11)

## Adding a new module

Putting the pieces together, a new main-process module needs: a C++ file with an `Initialize` and a `NODE_LINKED_BINDING_CONTEXT_AWARE(electron_browser_<name>, Initialize)` line; an entry in `ELECTRON_BROWSER_BINDINGS` so it is registered; a `lib/browser/api/<name>.ts` that calls `process._linkedBinding('electron_browser_<name>')`; and an entry in `browserModuleList`. The same steps apply with `common`, `renderer` or `utility` names in the other processes. The step-by-step guide is in `docs/development/creating-api.md`, and generated typings are in [[API Documentation Pipeline]].

Sources: [shell/common/node_bindings.cc:53-72](repo://shell/common/node_bindings.cc#L53-L72), [lib/browser/api/module-list.ts:1-10](repo://lib/browser/api/module-list.ts#L1-L10), [shell/browser/api/electron_api_dialog.cc:89-111](repo://shell/browser/api/electron_api_dialog.cc#L89-L111)
