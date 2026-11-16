---
title: "Quickstart"
---
## Overview

Create a small application that opens an 800-by-600 window and displays local HTML. The repository's first-app example waits for Electron readiness, creates a BrowserWindow, and handles the different close-and-reactivate behavior used on macOS. This procedure uses the published Electron package in a separate application directory. If your task is to change the framework's native executable, use [[Building and Testing Electron]] for the GN build workflow.

Sources: [docs/fiddles/tutorial-first-app/main.js:1-26](repo://docs/fiddles/tutorial-first-app/main.js#L1-L26), [docs/tutorial/tutorial-2-first-app.md:40-70](repo://docs/tutorial/tutorial-2-first-app.md#L40-L70), [docs/development/build-instructions-gn.md:3-30](repo://docs/development/build-instructions-gn.md#L3-L30)

## Initialize the application

With Node.js and npm available, create an application directory and initialize its package. Set the entry point to `main.js` when prompted. The application package is what Electron resolves when launched with a directory argument; its main script controls the main process and constructs the native interface.

Sources: [docs/tutorial/tutorial-2-first-app.md:40-56](repo://docs/tutorial/tutorial-2-first-app.md#L40-L56), [docs/tutorial/tutorial-2-first-app.md:117-135](repo://docs/tutorial/tutorial-2-first-app.md#L117-L135)

```sh
mkdir my-electron-app && cd my-electron-app
npm init
```

Sources: [docs/tutorial/tutorial-2-first-app.md:46-49](repo://docs/tutorial/tutorial-2-first-app.md#L46-L49)

Install Electron as a development dependency. The repository's tutorial explains that a packaged application carries the Electron binary, so the development dependency provides the runtime during application development. The package's postinstall script downloads and extracts that binary; [[Binary Installation and Application Startup]] explains its cache, platform selection, and installation checks.

Sources: [docs/tutorial/tutorial-2-first-app.md:58-76](repo://docs/tutorial/tutorial-2-first-app.md#L58-L76), [npm/package.json:4-13](repo://npm/package.json#L4-L13), [npm/install.js:41-90](repo://npm/install.js#L41-L90)

```sh
npm install electron --save-dev
```

Sources: [docs/tutorial/tutorial-2-first-app.md:69-71](repo://docs/tutorial/tutorial-2-first-app.md#L69-L71)

In the generated package, keep `main` set to `main.js` and add a `start` script whose value is `electron .`. Preserve the dependency version written by installation. The dot selects this application directory; the launcher forwards its arguments to the Electron executable. The repository root has its own `start` script for a locally built framework, so run this application script from the application directory you just initialized.

Sources: [docs/tutorial/tutorial-2-first-app.md:131-152](repo://docs/tutorial/tutorial-2-first-app.md#L131-L152), [npm/cli.js:3-14](repo://npm/cli.js#L3-L14), [script/start.js:1-8](repo://script/start.js#L1-L8)

## Create the main script

Copy the first-app main script into `main.js`. The `electron/main` alias makes the main-process API surface explicit. Window creation lives in a function because both initial readiness and a later activation can require a new window. The renderer's page is loaded by `loadFile`, whose navigation and completion behavior is described in [[Windows and Web Contents]].

Sources: [docs/fiddles/tutorial-first-app/main.js:1-26](repo://docs/fiddles/tutorial-first-app/main.js#L1-L26), [docs/tutorial/tutorial-2-first-app.md:235-245](repo://docs/tutorial/tutorial-2-first-app.md#L235-L245), [lib/browser/api/browser-window.ts:133-143](repo://lib/browser/api/browser-window.ts#L133-L143)

```js
const { app, BrowserWindow } = require('electron/main')

const createWindow = () => {
  const win = new BrowserWindow({
    width: 800,
    height: 600
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

Sources: [docs/fiddles/tutorial-first-app/main.js:1-26](repo://docs/fiddles/tutorial-first-app/main.js#L1-L26)

## Add local HTML

Create `index.html` beside `main.js` using the tutorial's static page below, with its explanatory HTML comment omitted. The content security policy restricts scripts to the same origin, and the page contains no renderer JavaScript. This is enough to demonstrate the initial window; adding privileged renderer capabilities is a separate step covered by [[Preloads and Context Isolation]].

Sources: [docs/tutorial/tutorial-2-first-app.md:163-190](repo://docs/tutorial/tutorial-2-first-app.md#L163-L190), [lib/renderer/api/context-bridge.ts:7-20](repo://lib/renderer/api/context-bridge.ts#L7-L20)

```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src 'self'"
    />
    <meta
      http-equiv="X-Content-Security-Policy"
      content="default-src 'self'; script-src 'self'"
    />
    <title>Hello from Electron renderer!</title>
  </head>
  <body>
    <h1>Hello from Electron renderer!</h1>
    <p>👋</p>
  </body>
</html>
```

Sources: [docs/tutorial/tutorial-2-first-app.md:170-189](repo://docs/tutorial/tutorial-2-first-app.md#L170-L189)

## Launch and check the lifecycle

Run the application's start command. The expected result is a native window containing the greeting from the HTML file. The code waits on `app.whenReady()` because BrowserWindow creation belongs after readiness; moving construction ahead of that point changes the startup contract rather than merely changing when the page appears.

Sources: [docs/tutorial/tutorial-2-first-app.md:131-157](repo://docs/tutorial/tutorial-2-first-app.md#L131-L157), [docs/tutorial/tutorial-2-first-app.md:271-284](repo://docs/tutorial/tutorial-2-first-app.md#L271-L284), [docs/fiddles/tutorial-first-app/main.js:3-13](repo://docs/fiddles/tutorial-first-app/main.js#L3-L13)

```sh
npm run start
```

Sources: [docs/tutorial/tutorial-2-first-app.md:155-157](repo://docs/tutorial/tutorial-2-first-app.md#L155-L157)

Closing every window calls `app.quit()` on platforms other than macOS. On macOS, the application remains available, and an `activate` event creates a replacement only when no BrowserWindow remains. Test both the initial opening and the relevant close behavior: the example deliberately distinguishes application lifetime from the lifetime of one window.

Sources: [docs/fiddles/tutorial-first-app/main.js:12-26](repo://docs/fiddles/tutorial-first-app/main.js#L12-L26)

## Diagnose an unsuccessful launch

If requiring the npm package reports that Electron failed to install correctly, executable resolution could not obtain its normal path metadata. The error specifically recommends deleting `node_modules/electron` and reinstalling. If the binary launches but cannot resolve the app directory or parse its package, the default application reports an error dialog and exits. These failures occur before the window code, and the separate stages in [[Binary Installation and Application Startup]] help identify which one failed.

Sources: [npm/index.js:6-18](repo://npm/index.js#L6-L18), [default_app/main.ts:85-103](repo://default_app/main.ts#L85-L103), [default_app/main.ts:126-148](repo://default_app/main.ts#L126-L148)
