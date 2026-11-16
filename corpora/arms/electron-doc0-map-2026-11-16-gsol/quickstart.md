---
title: "Quickstart"
---
## Overview

The checked-in quick-start example opens an 800 by 600 window, loads `index.html`, and uses `preload.js` to display the Node.js, Chromium, and Electron versions. It provides a small, complete path through the runtime described in [[Electron Overview]]: main-process application logic creates the window, while the preload waits for the document before changing its content.

Sources: [docs/fiddles/quick-start/main.js:1-30](repo://docs/fiddles/quick-start/main.js#L1-L30), [docs/fiddles/quick-start/preload.js:1-10](repo://docs/fiddles/quick-start/preload.js#L1-L10), [docs/fiddles/quick-start/index.html:1-16](repo://docs/fiddles/quick-start/index.html#L1-L16)

There are two useful starting points. An application can depend on a prebuilt Electron package, installed as a development dependency. A contributor running this repository's `npm start` instead launches the executable already built in its surrounding source tree. Choose the latter when checking a runtime change; its native setup is covered in [[Building and Testing Electron]]. Installing this repository's JavaScript dependencies alone does not supply the executable that `script/start.js` selects.

Sources: [README.md:22-30](repo://README.md#L22-L30), [package.json:60-94](repo://package.json#L60-L94), [script/start.js:1-8](repo://script/start.js#L1-L8), [script/lib/utils.js:8-61](repo://script/lib/utils.js#L8-L61)

## Install an application dependency

For a separate application project, the repository README gives this installation command. Run it in that application's directory so the dependency belongs to the application you intend to launch.

Sources: [README.md:22-30](repo://README.md#L22-L30)

```sh
npm install electron --save-dev
```

Sources: [README.md:28-30](repo://README.md#L28-L30)

The quick-start assets belong together: `main.js` constructs an absolute preload path from its own directory, and requests the relative document `index.html`. The runtime's `loadFile` resolves the document against `app.getAppPath()`. Keep the document and preload in the example's application directory when adapting these files, so both lookups refer to the same application.

Sources: [docs/fiddles/quick-start/main.js:1-14](repo://docs/fiddles/quick-start/main.js#L1-L14), [lib/browser/api/web-contents.ts:324-337](repo://lib/browser/api/web-contents.ts#L324-L337)

## Run the example with a local build

From the Electron repository root, after completing the native build, the following command passes the example's entry script to the local launcher. The launcher forwards its arguments to Electron. The default application accepts a positional file argument, resolves its module entry, and sets the application path to the entry's directory when no package directory was selected.

Sources: [script/start.js:1-8](repo://script/start.js#L1-L8), [default_app/main.ts:59-64](repo://default_app/main.ts#L59-L64), [default_app/main.ts:123-138](repo://default_app/main.ts#L123-L138), [default_app/main.ts:257-265](repo://default_app/main.ts#L257-L265)

```bash
node script/start.js docs/fiddles/quick-start/main.js
```

Sources: [script/start.js:5-8](repo://script/start.js#L5-L8), [default_app/main.ts:123-138](repo://default_app/main.ts#L123-L138), [docs/fiddles/quick-start/main.js:1-14](repo://docs/fiddles/quick-start/main.js#L1-L14)

The output directory selector checks `ELECTRON_OUT_DIR` when supplied; otherwise it tries `Testing`, `Release`, `Default`, and `Debug` in that order. The selected directory must exist under the parent source tree's `out` directory. A missing directory produces an explicit configuration error before the child process starts. This is the first place to inspect if the example never opens a window.

Sources: [script/lib/utils.js:8-61](repo://script/lib/utils.js#L8-L61)

## Follow the main process

The example imports `app` and `BrowserWindow` from `electron/main` and defines `createWindow`. The function constructs the window, attaches the preload path through `webPreferences`, and calls `win.loadFile('index.html')`. It is first called from `app.whenReady().then(...)`, making application readiness the gate before window creation.

Sources: [docs/fiddles/quick-start/main.js:1-17](repo://docs/fiddles/quick-start/main.js#L1-L17)

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

`BrowserWindow.loadFile` delegates to its WebContents. The WebContents implementation formats a file URL and delegates again to `loadURL`, which returns a promise watching load events. When extending the example to react to success or failure, that returned promise is the operation to observe; [[Windows and Navigation]] explains which events resolve or reject it and why a second navigation can abort the first.

Sources: [lib/browser/api/browser-window.ts:133-143](repo://lib/browser/api/browser-window.ts#L133-L143), [lib/browser/api/web-contents.ts:324-337](repo://lib/browser/api/web-contents.ts#L324-L337), [lib/browser/api/web-contents.ts:342-389](repo://lib/browser/api/web-contents.ts#L342-L389), [lib/browser/api/web-contents.ts:427-432](repo://lib/browser/api/web-contents.ts#L427-L432)

## Check the visible result

The document contains a “Hello World!” heading and three spans named `node-version`, `chrome-version`, and `electron-version`. At `DOMContentLoaded`, the preload iterates over those component names, finds each span, and writes the matching `process.versions` value. A missing element is skipped because `replaceText` checks the element before assigning `innerText`.

Sources: [docs/fiddles/quick-start/index.html:8-14](repo://docs/fiddles/quick-start/index.html#L8-L14), [docs/fiddles/quick-start/preload.js:1-10](repo://docs/fiddles/quick-start/preload.js#L1-L10)

This example uses preload access to the DOM directly. Applications exposing callable APIs into the page can instead use the context bridge described in [[Renderer Isolation and Preloads]]. That bridge checks context isolation before asking the native implementation to expose an API in the target world; adding a main-process operation then follows the routing described in [[Interprocess Communication]].

Sources: [docs/fiddles/quick-start/preload.js:1-10](repo://docs/fiddles/quick-start/preload.js#L1-L10), [lib/renderer/api/context-bridge.ts:3-19](repo://lib/renderer/api/context-bridge.ts#L3-L19), [lib/renderer/api/ipc-renderer.ts:8-27](repo://lib/renderer/api/ipc-renderer.ts#L8-L27)

## Close and reactivate the application

On `activate`, the example checks `BrowserWindow.getAllWindows()` and creates a window if the list is empty. On `window-all-closed`, it quits on platforms other than macOS. The two handlers work together: on macOS the process can remain available after the final window closes, and activation can create another window. On other platforms the example explicitly asks the application to quit.

Sources: [docs/fiddles/quick-start/main.js:16-30](repo://docs/fiddles/quick-start/main.js#L16-L30)

These handlers also affect Electron's bootstrap default: its own `window-all-closed` listener quits only when it is the sole listener. Registering the example's listener therefore makes the application's platform decision effective. [[Application Startup]] follows that default and the other bootstrap behavior that runs before this entry script.

Sources: [lib/browser/init.ts:186-191](repo://lib/browser/init.ts#L186-L191), [docs/fiddles/quick-start/main.js:26-30](repo://docs/fiddles/quick-start/main.js#L26-L30)
