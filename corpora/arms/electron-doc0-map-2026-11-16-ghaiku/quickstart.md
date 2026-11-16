---
title: "Quickstart"
---
## Overview

Electron runs an app in one of two ways: with the prebuilt binary that the `electron` npm package downloads, or with a binary you built from this source tree. Either way the executable starts `default_app` when it is given no app, and it loads the app you point it at otherwise.

Sources: [docs/development/source-code-directory-structure.md:17-18](repo://docs/development/source-code-directory-structure.md#L17-L18), [npm/index.js:4-21](repo://npm/index.js#L4-L21)

## Run an app with the npm package

1. Install the package in your app with `npm install electron --save-dev`. The package's `postinstall` script runs `npm/install.js`, which downloads the Electron zip for the package's version and unpacks it into `dist`.

Sources: [npm/package.json:8](repo://npm/package.json#L8), [npm/install.js:12](repo://npm/install.js#L12), [npm/install.js:42-53](repo://npm/install.js#L42-L53), [npm/install.js:74-77](repo://npm/install.js#L74-L77)

2. The install script writes `path.txt` with the executable's location for your platform. `npm/index.js` reads that file and exports the path to the executable, or uses `ELECTRON_OVERRIDE_DIST_PATH` when that variable is set.

Sources: [npm/install.js:18](repo://npm/install.js#L18), [npm/install.js:88-89](repo://npm/install.js#L88-L89), [npm/index.js:4-21](repo://npm/index.js#L4-L21)

3. Run your app with `npx electron .`. `npm/cli.js` spawns that executable with the arguments you gave, inherits its stdio, and forwards SIGINT and SIGTERM to it.

Sources: [npm/cli.js:5-14](repo://npm/cli.js#L5-L14), [npm/cli.js:16-25](repo://npm/cli.js#L16-L25)

## Run from a source checkout

After you build the binary (see [[Building from Source]]), `npm start` runs `script/start.js`. That script resolves the built executable with `getAbsoluteElectronExec` and spawns it with the rest of the command line, so `npm start -- path/to/app` runs an app. `npm run repl` passes `--interactive` to the same script and opens a REPL in the main process.

Sources: [script/start.js:3-8](repo://script/start.js#L3-L8), [script/lib/utils.js:60-62](repo://script/lib/utils.js#L60-L62), [package.json:89-91](repo://package.json#L89-L91)

## What the launcher accepts

The launcher reads the path argument and chooses a loader by its protocol or extension. An `http:`, `https:`, `file:` or `chrome:` URL loads by URL. A `.html` or `.htm` file loads directly. Anything else is treated as an app package: an `index.js` file or a folder with a `package.json`.

Sources: [default_app/main.ts:255-266](repo://default_app/main.ts#L255-L266), [default_app/main.ts:151-158](repo://default_app/main.ts#L151-L158)

With no path, the launcher prints its usage message and loads `index.html` through `loadApplicationByFile`. The usage message lists the same accepted path types.

Sources: [default_app/main.ts:276-297](repo://default_app/main.ts#L276-L297), [default_app/main.ts:281-286](repo://default_app/main.ts#L281-L286)
