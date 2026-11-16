---
title: "Quickstart"
---
## Overview

The included quick-start application opens one native window, loads a local HTML document, and fills in runtime versions from a preload script. It is a small way to exercise the framework described in [[Electron Overview]]. You can run it with an installed Electron binary or with a binary compiled from this repository. These routes share the same application files; compilation belongs to [[Building Electron]].

Sources: [docs/fiddles/quick-start/main.js:1-30](repo://docs/fiddles/quick-start/main.js#L1-L30), [docs/fiddles/quick-start/preload.js:1-10](repo://docs/fiddles/quick-start/preload.js#L1-L10), [script/start.js:1-8](repo://script/start.js#L1-L8)

## Run the sample with an installed binary

Create an application directory and copy `main.js`, `preload.js`, and `index.html` from `docs/fiddles/quick-start` into it. Initialize an npm package there, set its `main` field to `main.js`, and install Electron as a development dependency. The repository's first-app tutorial uses this package structure because Electron discovers an application's entry through its package metadata. The sample itself is a set of source files, so supply the package manifest in your application directory.

Sources: [docs/tutorial/tutorial-2-first-app.md:40-91](repo://docs/tutorial/tutorial-2-first-app.md#L40-L91), [docs/fiddles/quick-start/main.js:1-14](repo://docs/fiddles/quick-start/main.js#L1-L14), [docs/fiddles/quick-start/preload.js:1-10](repo://docs/fiddles/quick-start/preload.js#L1-L10), [docs/fiddles/quick-start/index.html:1-16](repo://docs/fiddles/quick-start/index.html#L1-L16)

```sh
npm install electron --save-dev
```

Sources: [README.md:24-30](repo://README.md#L24-L30)

Add a `start` script whose value is `electron .`, then run it with npm. The npm package exposes the `electron` command through `cli.js`; that launcher forwards arguments to the executable. The dot therefore reaches the default application's package loader as the application path. [[Application Startup]] explains how this development loader differs from loading an application directly from the runtime's resources directory.

Sources: [docs/tutorial/tutorial-2-first-app.md:131-145](repo://docs/tutorial/tutorial-2-first-app.md#L131-L145), [npm/package.json:1-9](repo://npm/package.json#L1-L9), [npm/cli.js:3-13](repo://npm/cli.js#L3-L13), [default_app/main.ts:253-266](repo://default_app/main.ts#L253-L266)

## Understand the main script

The window creation function imports `BrowserWindow` from `electron/main`, chooses an 800 by 600 initial size, and supplies an absolute preload path derived from the script directory. The document path passed to `loadFile` is relative to the application path. Keep these filenames aligned when copying the sample: the preload and HTML are inputs to different parts of the load sequence.

Sources: [docs/fiddles/quick-start/main.js:1-14](repo://docs/fiddles/quick-start/main.js#L1-L14), [lib/browser/api/web-contents.ts:324-337](repo://lib/browser/api/web-contents.ts#L324-L337)

```javascript
function createWindow () {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js')
    }
  })

  win.loadFile('index.html')
}
```

Sources: [docs/fiddles/quick-start/main.js:4-14](repo://docs/fiddles/quick-start/main.js#L4-L14)

The application waits for `app.whenReady()` before calling that function. It also handles `activate` by recreating a window only when `BrowserWindow.getAllWindows()` is empty. On `window-all-closed`, it quits on platforms other than macOS. These handlers make application lifetime explicit: closing the visible document and terminating the main process are separate decisions.

Sources: [docs/fiddles/quick-start/main.js:16-30](repo://docs/fiddles/quick-start/main.js#L16-L30)

## Check the document and preload

The HTML contains placeholders named `node-version`, `chrome-version`, and `electron-version`. The preload waits for `DOMContentLoaded`, looks each element up by ID, and assigns the corresponding `process.versions` string. A successful run displays those values inside the Hello World document. The preload checks that an element exists before changing its text, so removing a placeholder leaves that update unused.

Sources: [docs/fiddles/quick-start/index.html:8-16](repo://docs/fiddles/quick-start/index.html#L8-L16), [docs/fiddles/quick-start/preload.js:1-10](repo://docs/fiddles/quick-start/preload.js#L1-L10)

This sample performs its DOM work entirely in the preload. To provide callable application capabilities to page scripts, the framework offers `contextBridge`, whose public operations require context isolation. [[Renderer Preloads and Isolation]] follows that boundary, and [[IPC and Message Ports]] follows calls that need main-process work. The sample's direct version substitution does not need a channel handler.

Sources: [docs/fiddles/quick-start/preload.js:1-10](repo://docs/fiddles/quick-start/preload.js#L1-L10), [lib/renderer/api/context-bridge.ts:3-19](repo://lib/renderer/api/context-bridge.ts#L3-L19), [lib/renderer/api/ipc-renderer.ts:21-26](repo://lib/renderer/api/ipc-renderer.ts#L21-L26)

## Run a locally built framework

After completing [[Building Electron]], use the repository's `npm start` command and pass the sample's main-script path as an argument. The root package maps `start` to `script/start.js`. That script resolves the compiled executable and spawns it with the remaining command-line arguments and inherited standard streams. It forwards termination signals and exits with the child's close code.

Sources: [package.json:90-94](repo://package.json#L90-L94), [script/start.js:1-19](repo://script/start.js#L1-L19), [default_app/main.ts:281-286](repo://default_app/main.ts#L281-L286)

```sh
npm start -- docs/fiddles/quick-start/main.js
```

Sources: [package.json:90-94](repo://package.json#L90-L94), [script/start.js:5-8](repo://script/start.js#L5-L8), [docs/fiddles/quick-start/main.js:1-14](repo://docs/fiddles/quick-start/main.js#L1-L14)

Build lookup searches the parent checkout's `out` directory. `ELECTRON_OUT_DIR` selects a particular configured subdirectory; without it, lookup tries `Testing`, `Release`, `Default`, and `Debug` in that order. A missing configured directory or absence of every preset raises an error before launch. Installing the root JavaScript dependencies alone does not create this executable.

Sources: [script/lib/utils.js:8-61](repo://script/lib/utils.js#L8-L61), [script/start.js:5-7](repo://script/start.js#L5-L7)

## Locate launch failures

If the installed package cannot resolve `path.txt` and no override is supplied, it reports that Electron failed to install correctly. If application resolution fails, the default application displays an error box and exits with status 1. Once a window exists, document load failures follow the promise behavior in [[Windows and Navigation]], which attaches an error code, description, and URL to rejected navigation errors.

Sources: [npm/index.js:6-18](repo://npm/index.js#L6-L18), [default_app/main.ts:126-148](repo://default_app/main.ts#L126-L148), [lib/browser/api/web-contents.ts:342-354](repo://lib/browser/api/web-contents.ts#L342-L354)
