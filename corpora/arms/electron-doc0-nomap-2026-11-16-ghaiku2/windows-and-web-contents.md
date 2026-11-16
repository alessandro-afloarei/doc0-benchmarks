---
title: "Windows and Web Contents"
---
## Overview

A `BrowserWindow` in Electron is three objects stacked together: a native platform window, a content view, and the Chromium `WebContents` that renders the page. The C++ classes `BaseWindow` and `BrowserWindow` own the first two, and `WebContents` owns the third. Their JavaScript wrappers add the events and defaults that apps see. This page follows the creation path and the platform split. Message passing between these objects and the renderers is covered in [[Inter-process Messaging]], and the module wiring that exposes the classes is in [[Main Process Modules]].

Sources: [shell/browser/api/electron_api_browser_window.cc:28-33](repo://shell/browser/api/electron_api_browser_window.cc#L28-L33)

## Creating a window

`BrowserWindow::New` refuses to run until the app is ready, and then constructs the object. The constructor calls the `BaseWindow` constructor first, which creates the platform window, and only then builds the page.

Sources: [shell/browser/api/electron_api_browser_window.cc:293-300](repo://shell/browser/api/electron_api_browser_window.cc#L293-L300)

Sources: [shell/browser/api/electron_api_base_window.cc:96-116](repo://shell/browser/api/electron_api_base_window.cc#L96-L116)

`BaseWindow` creates the `NativeWindow` through `NativeWindow::Create`, adds itself as an observer, and installs an empty content view. The `NativeWindow` object is the boundary between shared code and the platform.

Sources: [shell/browser/api/electron_api_base_window.cc:111-116](repo://shell/browser/api/electron_api_base_window.cc#L111-L116)

## Platform split

`NativeWindow::Create` is defined once per platform. The Linux and Windows build returns a `NativeWindowViews`, which draws through the Views toolkit. The macOS build returns a `NativeWindowMac`, which uses AppKit.

Sources: [shell/browser/native_window_views.cc:1950-1955](repo://shell/browser/native_window_views.cc#L1950-L1955)

Sources: [shell/browser/native_window_mac.mm:1879-1884](repo://shell/browser/native_window_mac.mm#L1879-L1884)

Both platform classes derive from the shared `NativeWindow` interface in `native_window.h`, which declares the methods that `BaseWindow` calls, such as setting bounds and content.

Sources: [shell/browser/native_window.h:80-104](repo://shell/browser/native_window.h#L80-L104)

## Attaching a web contents

After the base window exists, `BrowserWindow` reads the `webPreferences` option and sets `show` to `true` unless the app said otherwise. It then creates a `WebContentsView` and gets its `WebContents` from it. The view is added to the window's contents view, and the window's ownership is set on the web contents.

Sources: [shell/browser/api/electron_api_browser_window.cc:58-94](repo://shell/browser/api/electron_api_browser_window.cc#L58-L94)

The `WebContents` constructor builds the `content::WebContents` that Chromium renders. A guest uses a site instance on a fake host. A normal page uses the browser context of the session from the options.

Sources: [shell/browser/api/electron_api_web_contents.cc:785-889](repo://shell/browser/api/electron_api_web_contents.cc#L785-L889)

`InitWithWebContents` sets the browser context, makes the `WebContents` its own delegate, and attaches the printing helpers.

Sources: [shell/browser/api/electron_api_web_contents.cc:1013-1022](repo://shell/browser/api/electron_api_web_contents.cc#L1013-L1022)

## JavaScript wiring

The JavaScript side runs its `_init` hooks after the native object is created. `BaseWindow.prototype._init` builds the application menu on platforms other than macOS, and `BrowserWindow.prototype._init` wires focus, blur and unresponsive events to `app` and the web contents.

Sources: [lib/browser/api/base-window.ts:10-14](repo://lib/browser/api/base-window.ts#L10-L14)

Sources: [lib/browser/api/browser-window.ts:8-27](repo://lib/browser/api/browser-window.ts#L8-L27)

`WebContents.prototype._init` reads the last web preferences and warns about the default sandbox change. The same file gives each web contents its own `ipc` object, an `IpcMainImpl` that receives only that page's messages.

Sources: [lib/browser/api/web-contents.ts:537-541](repo://lib/browser/api/web-contents.ts#L537-L541)

Sources: [lib/browser/api/web-contents.ts:550-556](repo://lib/browser/api/web-contents.ts#L550-L556)
