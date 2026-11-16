---
title: "Quickstart"
---
## Overview

Run the three-file example under `docs/fiddles/quick-start` to see the application, window and preload boundaries described in [[Electron Architecture]]. Its main script creates an 800 by 600 window, loads local HTML and supplies a preload that displays the running Node.js, Chromium and Electron versions. This page uses a prebuilt Electron installation; [[Building and Testing Electron]] covers compiling the framework in this repository.

Sources: [docs/fiddles/quick-start/main.js:1-30](repo://docs/fiddles/quick-start/main.js#L1-L30), [docs/fiddles/quick-start/preload.js:1-10](repo://docs/fiddles/quick-start/preload.js#L1-L10), [docs/fiddles/quick-start/index.html:1-16](repo://docs/fiddles/quick-start/index.html#L1-L16), [docs/development/build-instructions-gn.md:1-21](repo://docs/development/build-instructions-gn.md#L1-L21)

## Prepare the example

Use a separate application directory and copy `main.js`, `preload.js` and `index.html` from the quick-start example into it, keeping the filenames unchanged. The main script derives the preload path from its own directory and calls `loadFile('index.html')`. The loader establishes the app directory from the resolved entry file, so keeping these three files together preserves both paths.

Sources: [docs/fiddles/quick-start/main.js:1-14](repo://docs/fiddles/quick-start/main.js#L1-L14), [default_app/main.ts:126-137](repo://default_app/main.ts#L126-L137), [lib/browser/api/web-contents.ts:324-337](repo://lib/browser/api/web-contents.ts#L324-L337)

With Node.js and npm available, install Electron as a development dependency in that application directory. This is the installation command documented by the repository. The npm package downloads a runtime artifact during installation, so the application directory does not need Chromium source or a GN build to launch this example.

Sources: [README.md:22-34](repo://README.md#L22-L34), [npm/install.js:3-16](repo://npm/install.js#L3-L16), [npm/install.js:41-53](repo://npm/install.js#L41-L53)

```sh
npm install electron --save-dev
```

Sources: [README.md:24-30](repo://README.md#L24-L30)

## Launch the main script

From the application directory, run `npx electron main.js`. Supplying the JavaScript entry explicitly means the launch does not depend on a `main` field in an application package. The CLI forwards its arguments to the executable, and the default application loader resolves the supplied file, sets the application path and imports it. For subsequent experiments, preserve that explicit entry path until you deliberately introduce package-level startup configuration.

Sources: [npm/cli.js:3-14](repo://npm/cli.js#L3-L14), [default_app/main.ts:35-64](repo://default_app/main.ts#L35-L64), [default_app/main.ts:126-137](repo://default_app/main.ts#L126-L137), [default_app/main.ts:253-266](repo://default_app/main.ts#L253-L266)

The main script below is the repository's complete example. `app.whenReady()` schedules window creation after initialization. A preload path belongs in `webPreferences`; the visible document is loaded separately. [[Windows and Navigation]] explains how these calls reach the native window and Chromium navigation controller.

Sources: [docs/fiddles/quick-start/main.js:1-30](repo://docs/fiddles/quick-start/main.js#L1-L30), [shell/browser/api/electron_api_browser_window.cc:28-34](repo://shell/browser/api/electron_api_browser_window.cc#L28-L34), [shell/browser/api/electron_api_browser_window.cc:67-98](repo://shell/browser/api/electron_api_browser_window.cc#L67-L98), [shell/browser/api/electron_api_web_contents.cc:2393-2404](repo://shell/browser/api/electron_api_web_contents.cc#L2393-L2404)

```javascript
const { app, BrowserWindow } = require('electron/main')
const path = require('node:path')

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

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
```

Sources: [docs/fiddles/quick-start/main.js:1-30](repo://docs/fiddles/quick-start/main.js#L1-L30)

## Verify the visible result

The window should show “Hello World!” and three runtime versions. The HTML contains separate spans for those values. The preload waits for `DOMContentLoaded`, looks up each span and writes the corresponding value from `process.versions`. A visible page with empty version fields therefore points toward the preload path or execution, while a missing document points toward the HTML load. [[Preloads and Context Isolation]] follows the preload initialization and error path.

Sources: [docs/fiddles/quick-start/index.html:8-14](repo://docs/fiddles/quick-start/index.html#L8-L14), [docs/fiddles/quick-start/preload.js:1-10](repo://docs/fiddles/quick-start/preload.js#L1-L10), [docs/fiddles/quick-start/main.js:8-13](repo://docs/fiddles/quick-start/main.js#L8-L13)

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

Close the window to exercise the sample's lifecycle. On platforms other than macOS, its `window-all-closed` listener calls `app.quit()`. On macOS the listener leaves the application running; a later `activate` event recreates a window only when the window list is empty. [[Application Startup and Lifecycle]] explains how installing this listener changes Electron's default quit behavior.

Sources: [docs/fiddles/quick-start/main.js:16-30](repo://docs/fiddles/quick-start/main.js#L16-L30), [lib/browser/init.ts:186-191](repo://lib/browser/init.ts#L186-L191)

## Diagnose launch failures

| Symptom | Implementation boundary to check |
| --- | --- |
| The npm package reports that Electron failed to install | `path.txt` is absent and no distribution override supplied a path; inspect the installation described in [[Binary Installation and ASAR]] |
| “Unable to find Electron app” | The default loader could not resolve the supplied entry path |
| “Unable to parse” a package file | The loader found a package file but its JSON import failed |
| An error appears during app load | The loader logs the stack and rethrows the entry-script failure |
| HTML loads without versions | Check that the copied preload is at the path configured by the main script |

Sources: [npm/index.js:4-18](repo://npm/index.js#L4-L18), [default_app/main.ts:85-103](repo://default_app/main.ts#L85-L103), [default_app/main.ts:126-148](repo://default_app/main.ts#L126-L148), [docs/fiddles/quick-start/main.js:8-13](repo://docs/fiddles/quick-start/main.js#L8-L13), [docs/fiddles/quick-start/preload.js:1-10](repo://docs/fiddles/quick-start/preload.js#L1-L10)

For a launch-only check, `npx electron --version` takes the default loader's version branch and exits after printing the runtime version. It does not exercise this application's window or preload. Keep the visible version check above when testing changes to the three example files, because those fields prove that the preload reached the loaded document.

Sources: [default_app/main.ts:40-42](repo://default_app/main.ts#L40-L42), [default_app/main.ts:267-269](repo://default_app/main.ts#L267-L269), [docs/fiddles/quick-start/preload.js:1-10](repo://docs/fiddles/quick-start/preload.js#L1-L10)

## Move to a source build

The repository root's `npm start` runs `script/start.js`, which resolves a locally built Electron executable and spawns it. Its `npm test` invokes the framework spec runner, with a pretest step for type generation. Use [[Building and Testing Electron]] when changing Electron itself; these root scripts serve the contributor checkout rather than the separate sample application directory prepared here.

Sources: [package.json:79-93](repo://package.json#L79-L93), [script/start.js:1-8](repo://script/start.js#L1-L8)
