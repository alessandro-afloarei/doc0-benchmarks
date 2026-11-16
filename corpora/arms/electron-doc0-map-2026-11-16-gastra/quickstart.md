---
title: "Quickstart"
---
## Overview

The checked-in quick-start example creates an 800 by 600 desktop window, loads a local HTML document and fills in the Node.js, Chromium and Electron version strings from a preload script. It is a small application for following the main-process and renderer responsibilities described in [[Electron Architecture]]. Its three source files are `main.js`, `preload.js` and `index.html` under `docs/fiddles/quick-start`.

Sources: [docs/fiddles/quick-start/main.js:1-30](repo://docs/fiddles/quick-start/main.js#L1-L30), [docs/fiddles/quick-start/preload.js:1-10](repo://docs/fiddles/quick-start/preload.js#L1-L10), [docs/fiddles/quick-start/index.html:1-16](repo://docs/fiddles/quick-start/index.html#L1-L16)

## Choose the executable

For an application project, the repository's installation instructions use `npm install electron --save-dev`. Create a separate application folder, initialize its package with `npm init`, set its entry point to `main.js`, and copy the example's three files into it. This gives the application its own package metadata and installed executable. The framework repository's own package is private and its `start` script selects a locally built framework binary, so use [[Building and Testing]] when your goal is to run modifications to Electron itself.

Sources: [README.md:22-34](repo://README.md#L22-L34), [docs/tutorial/tutorial-2-first-app.md:40-71](repo://docs/tutorial/tutorial-2-first-app.md#L40-L71), [docs/fiddles/quick-start/main.js:1-14](repo://docs/fiddles/quick-start/main.js#L1-L14), [docs/fiddles/quick-start/preload.js:1-10](repo://docs/fiddles/quick-start/preload.js#L1-L10), [docs/fiddles/quick-start/index.html:1-16](repo://docs/fiddles/quick-start/index.html#L1-L16), [package.json:60-94](repo://package.json#L60-L94), [script/start.js:1-8](repo://script/start.js#L1-L8)

In that separate application folder, launch the installed Electron executable with the application directory as its argument: `npx electron .`. The default application accepts a path, resolves its package entry and sets the application path before loading it. Alternatively, after building this repository, run `npm start -- docs/fiddles/quick-start/main.js` from the repository root. The start wrapper forwards this script argument unchanged, and the default application sets the application path to the resolved script's directory when there is no package directory metadata.

Sources: [default_app/main.ts:35-65](repo://default_app/main.ts#L35-L65), [default_app/main.ts:77-137](repo://default_app/main.ts#L77-L137), [default_app/main.ts:253-265](repo://default_app/main.ts#L253-L265), [script/start.js:1-8](repo://script/start.js#L1-L8), [package.json:90-92](repo://package.json#L90-L92)

## Create the first window

The main script imports `app` and `BrowserWindow` from `electron/main` and Node's path module. Its `createWindow` function owns the window options and associates the preload through an absolute path based on `__dirname`. The filename passed to `loadFile` is relative; WebContents resolves it against `app.getAppPath()`, which is why the launcher's application-path setup matters. [[Windows and Navigation]] explains the loading promise and its error behavior.

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

The first call to `createWindow` happens inside `app.whenReady().then(...)`. Inside the same readiness callback, the example subscribes to `activate` and checks the current window count before creating another window. This check avoids opening a new example window on every activation when one already exists. [[Application Startup]] explains how Electron executes this main module before its application lifecycle proceeds.

Sources: [docs/fiddles/quick-start/main.js:16-24](repo://docs/fiddles/quick-start/main.js#L16-L24), [lib/browser/init.ts:204-222](repo://lib/browser/init.ts#L204-L222)

## Populate the document

The HTML contains a Hello World heading and three spans with IDs matching the version names. The preload waits for `DOMContentLoaded`, then looks up each span before assigning its `innerText`. Its existence check means an absent span is skipped. A visible heading alone verifies that the document loaded; populated version strings additionally show that the preload's DOM callback ran and found the expected element IDs.

Sources: [docs/fiddles/quick-start/index.html:8-14](repo://docs/fiddles/quick-start/index.html#L8-L14), [docs/fiddles/quick-start/preload.js:1-10](repo://docs/fiddles/quick-start/preload.js#L1-L10)

```javascript
window.addEventListener('DOMContentLoaded', () => {
  const replaceText = (selector, text) => {
    const element = document.getElementById(selector)
    if (element) element.innerText = text
  }

  for (const type of ['chrome', 'node', 'electron']) {
    replaceText(`${type}-version`, process.versions[type])
  }
})
```

Sources: [docs/fiddles/quick-start/preload.js:1-10](repo://docs/fiddles/quick-start/preload.js#L1-L10)

The example does not need an IPC handler to display these values: the preload reads `process.versions` directly and updates the DOM. For a renderer feature that calls into main-process code, [[Preload and Context Isolation]] describes how to expose an API into the page's world, and [[IPC Dispatch]] describes how an invocation returns its result. Those are extensions to this example, whose current main script only manages windows and lifecycle.

Sources: [docs/fiddles/quick-start/preload.js:1-10](repo://docs/fiddles/quick-start/preload.js#L1-L10), [docs/fiddles/quick-start/main.js:1-30](repo://docs/fiddles/quick-start/main.js#L1-L30), [lib/renderer/api/context-bridge.ts:7-19](repo://lib/renderer/api/context-bridge.ts#L7-L19), [lib/renderer/api/ipc-renderer.ts:21-27](repo://lib/renderer/api/ipc-renderer.ts#L21-L27)

## Close and reactivate

The `window-all-closed` handler quits the application on platforms other than macOS. On macOS it leaves the application running, so a later activation can recreate a window through the handler installed after readiness. This is application policy encoded by the example. The runtime has its own default listener, but it only calls `app.quit()` when it is the sole `window-all-closed` listener; registering the example handler takes responsibility for that decision.

Sources: [docs/fiddles/quick-start/main.js:16-30](repo://docs/fiddles/quick-start/main.js#L16-L30), [lib/browser/init.ts:186-191](repo://lib/browser/init.ts#L186-L191)

## Diagnose the first run

If the repository launch fails before a window opens with a missing output-directory error, the start wrapper has not found a configured build. Its selection checks the explicit `ELECTRON_OUT_DIR` value or the standard Testing, Release, Default and Debug directories beside the Electron checkout. Follow [[Building and Testing]] to produce the executable selected by this wrapper; installing application dependencies alone does not create that native output directory.

Sources: [script/start.js:1-8](repo://script/start.js#L1-L8), [script/lib/utils.js:8-61](repo://script/lib/utils.js#L8-L61), [docs/development/build-instructions-gn.md:163-189](repo://docs/development/build-instructions-gn.md#L163-L189)

If the window appears without version text, compare the preload path and the three element IDs with the example. Sandboxed preload execution logs the script path and error when a script fails, then sends an internal preload-error message. If the local document itself fails to load, follow the WebContents load result described in [[Windows and Navigation]]; the example currently starts the load without awaiting or catching the returned promise.

Sources: [docs/fiddles/quick-start/main.js:8-13](repo://docs/fiddles/quick-start/main.js#L8-L13), [docs/fiddles/quick-start/preload.js:1-10](repo://docs/fiddles/quick-start/preload.js#L1-L10), [lib/sandboxed_renderer/preload.ts:87-100](repo://lib/sandboxed_renderer/preload.ts#L87-L100), [lib/browser/api/web-contents.ts:427-432](repo://lib/browser/api/web-contents.ts#L427-L432)
