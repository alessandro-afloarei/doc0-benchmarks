---
title: "System Integration Modules"
---
## Overview

Besides windows and web content, the main process exposes a set of modules that wrap operating-system services: dialogs, notifications, the clipboard, the shell, displays, theme, power events, secure storage, updates, crash reporting, screen capture and images. Each follows the pattern described in [[Native API Bindings with gin]]: a C++ implementation registered as a linked binding, often with per-platform files, and a short TypeScript module in `lib/` that exports it and sometimes adds behaviour. This page is a catalogue: what each module is for, where it lives, and the details that affect how it is used. Menus, global shortcuts and the tray are covered in [[Menus, Accelerators and Tray]].

Sources: [lib/browser/api/module-list.ts:4-43](repo://lib/browser/api/module-list.ts#L4-L43), [lib/common/api/module-list.ts:1-5](repo://lib/common/api/module-list.ts#L1-L5)

## Catalogue

| Module | Use it to | Implementation |
| --- | --- | --- |
| `dialog` | Show open, save and message-box dialogs | `lib/browser/api/dialog.ts` over `electron_browser_dialog`; `shell/browser/ui/file_dialog_*` and `message_box_*` per platform |
| `Notification` | Show desktop notifications | `api::Notification` using the browser client's `NotificationPresenter` (`shell/browser/notifications/{linux,mac,win}`) |
| `clipboard` | Read and write text, HTML, images, bookmarks | `electron_common_clipboard`; usable from main and renderers |
| `shell` | Open URLs and files with the OS, show files in folders, trash files, Windows shortcuts | `electron_common_shell` (`shell/common/api/electron_api_shell.cc`) |
| `nativeImage` | Load, convert, resize and crop images used by other APIs | `electron_common_native_image` (`api::NativeImage`) |
| `screen` | Query displays and the cursor; observe display changes | `electron_browser_screen`, created lazily |
| `nativeTheme` | Read or force light/dark mode | `api::NativeTheme`, emits `updated` |
| `powerMonitor` | Observe suspend, resume, AC/battery, lock and shutdown | `api::PowerMonitor` with Windows and macOS specialisations |
| `powerSaveBlocker` | Keep the system or display awake | Device-service wake locks |
| `systemPreferences` | Platform preferences: accent colour, animation settings, macOS defaults, Windows colours | `api::SystemPreferences` with `_mac` and `_win` files |
| `safeStorage` | Encrypt strings with the OS key store | `OSCrypt` |
| `autoUpdater` | Install updates from a Squirrel feed | Squirrel.Mac natively; Squirrel.Windows through `Update.exe` |
| `crashReporter` | Collect and upload crash dumps | Crashpad |
| `desktopCapturer` | List screens and windows for capture | `electron_browser_desktop_capturer` |

Sources: [lib/browser/api/module-list.ts:4-43](repo://lib/browser/api/module-list.ts#L4-L43), [lib/common/api/shell.ts:1-3](repo://lib/common/api/shell.ts#L1-L3), [lib/common/api/native-image.ts:1-3](repo://lib/common/api/native-image.ts#L1-L3), [lib/browser/api/clipboard.ts:1-3](repo://lib/browser/api/clipboard.ts#L1-L3)

## Module notes

### dialog

Every dialog function throws before the app is ready. Each takes an optional parent window as its first argument (anything that is not a `BaseWindow` is treated as the options). The JavaScript layer validates options, converts the `properties` arrays into bit flags for the native side, normalises access keys in button labels, and calls the synchronous or promise-returning native function; message boxes get an ID so they can be closed through an `AbortSignal`.

Sources: [lib/browser/api/dialog.ts:27-75](repo://lib/browser/api/dialog.ts#L27-L75), [lib/browser/api/dialog.ts:156-262](repo://lib/browser/api/dialog.ts#L156-L262)

### Notification

`api::Notification` holds the notification's fields and gets the platform presenter from `ElectronBrowserClient` when constructed. The platform implementation reports back through delegate callbacks that become the `show`, `click`, `close`, `reply`, `action` and `failed` events. Web notifications created by pages are allowed through `ElectronBrowserClient::WebNotificationAllowed`, which first runs the page's permission request.

Sources: [shell/browser/api/electron_api_notification.cc:50-80](repo://shell/browser/api/electron_api_notification.cc#L50-L80), [shell/browser/api/electron_api_notification.cc:141-170](repo://shell/browser/api/electron_api_notification.cc#L141-L170), [shell/browser/electron_browser_client.cc:849-866](repo://shell/browser/electron_browser_client.cc#L849-L866)

### clipboard

The main process uses the binding directly. In renderers, Linux clipboard access is not possible from the renderer process, so every method is replaced by a synchronous internal IPC call to the main process; on macOS only the find-pasteboard methods are remoted, because only the main process is notified of its changes. The main-process handler accepts exactly those methods, as described in [[Inter-Process Communication]].

Sources: [lib/renderer/api/clipboard.ts:1-21](repo://lib/renderer/api/clipboard.ts#L1-L21), [lib/browser/rpc-server.ts:32-50](repo://lib/browser/rpc-server.ts#L32-L50)

### screen

The display observer cannot be created before `ready`, yet `require('electron').screen` must be importable at any time. `lib/browser/api/screen.ts` therefore exports a `Proxy` that calls `createScreen()` on first property access and forwards everything to the real object.

Sources: [lib/browser/api/screen.ts:1-40](repo://lib/browser/api/screen.ts#L1-L40)

### powerMonitor

The JavaScript wrapper starts the native monitor only when the first listener is added (and after `ready`), and on Linux tells it whether any `shutdown` listener exists so it only inhibits system shutdown when someone can respond. Events come from Chromium's power observers (`suspend`, `resume`, `on-ac`, `on-battery`, `shutdown`) and from platform code: Windows session notifications and macOS distributed notifications give `lock-screen` and `unlock-screen`, and macOS adds `user-did-become-active` and `user-did-resign-active`.

Sources: [lib/browser/api/power-monitor.ts:11-50](repo://lib/browser/api/power-monitor.ts#L11-L50), [shell/browser/api/electron_api_power_monitor.cc:88-115](repo://shell/browser/api/electron_api_power_monitor.cc#L88-L115), [shell/browser/api/electron_api_power_monitor_win.cc:78-90](repo://shell/browser/api/electron_api_power_monitor_win.cc#L78-L90), [shell/browser/api/electron_api_power_monitor_mac.mm:62-88](repo://shell/browser/api/electron_api_power_monitor_mac.mm#L62-L88)

### powerSaveBlocker

`start(type)` returns an ID and `stop(id)` releases it. All active blockers are combined into one device-service wake lock: if any asks for `prevent-display-sleep` that type wins, otherwise `prevent-app-suspension` applies, and the lock is cancelled when none remain.

Sources: [shell/browser/api/electron_api_power_save_blocker.cc:52-115](repo://shell/browser/api/electron_api_power_save_blocker.cc#L52-L115)

### safeStorage

`encryptString` and `decryptString` use Chromium's `OSCrypt`, the same key store that protects cookies: the macOS Keychain entry named `<app> Safe Storage` and the Linux password store chosen at startup ([[Process Model and Native Startup]]). They are unavailable before `ready`. Decryption checks for the `v10` or `v11` prefix `OSCrypt` writes. On Linux, `isEncryptionAvailable` reports false when only the plain-text `basic_text` backend exists, unless the app opted into it with `setUsePlainTextEncryption`.

Sources: [shell/browser/api/electron_api_safe_storage.cc:19-125](repo://shell/browser/api/electron_api_safe_storage.cc#L19-L125), [shell/browser/electron_browser_main_parts.cc:510-547](repo://shell/browser/electron_browser_main_parts.cc#L510-L547)

### autoUpdater

The module is chosen per platform. On macOS and Linux it is the native binding, which on macOS drives Squirrel.Mac's `SQRLUpdater`. On Windows it is a JavaScript `EventEmitter` that runs Squirrel.Windows's `Update.exe` from the parent of the app directory to download updates and restart into them.

Sources: [lib/browser/api/auto-updater.ts:1-5](repo://lib/browser/api/auto-updater.ts#L1-L5), [lib/browser/api/auto-updater/auto-updater-native.ts:1-3](repo://lib/browser/api/auto-updater/auto-updater-native.ts#L1-L3), [shell/browser/auto_updater_mac.mm:12-28](repo://shell/browser/auto_updater_mac.mm#L12-L28), [lib/browser/api/auto-updater/auto-updater-win.ts:1-40](repo://lib/browser/api/auto-updater/auto-updater-win.ts#L1-L40), [lib/browser/api/auto-updater/squirrel-update-win.ts:1-14](repo://lib/browser/api/auto-updater/squirrel-update-win.ts#L1-L14)

### crashReporter

`crashReporter.start` requires a `submitURL` when uploading, defaults the product name to `app.name`, adds `_productName`, `_version` and optionally `_companyName` to the global annotations, and passes everything to the binding. In the main process Crashpad waits for this call: `ElectronMainDelegate` initialises it at boot only in child processes ([[Process Model and Native Startup]]). Processes running in Node mode get a `process.crashReporter` object for annotations.

Sources: [lib/browser/api/crash-reporter.ts:7-60](repo://lib/browser/api/crash-reporter.ts#L7-L60), [shell/browser/api/electron_api_crash_reporter.cc:150-160](repo://shell/browser/api/electron_api_crash_reporter.cc#L150-L160), [shell/app/electron_main_delegate.cc:370-390](repo://shell/app/electron_main_delegate.cc#L370-L390), [shell/app/node_main.cc:267-283](repo://shell/app/node_main.cc#L267-L283)

### desktopCapturer

`getSources({ types, thumbnailSize, fetchWindowIcons })` creates a native capturer per request and resolves with screens and windows, each with a thumbnail. Identical concurrent requests share one capture. On macOS it records which windows were non-resizable and restores them afterwards, working around a ScreenCaptureKit bug. The returned source IDs are what `session.setDisplayMediaRequestHandler` hands to `getDisplayMedia` ([[Sessions and Browser Contexts]]).

Sources: [lib/browser/api/desktop-capturer.ts:19-60](repo://lib/browser/api/desktop-capturer.ts#L19-L60), [lib/browser/api/session.ts:48-58](repo://lib/browser/api/session.ts#L48-L58)

### nativeImage

`nativeImage` builds images from PNG or JPEG buffers, file paths, bitmaps, data URLs and, on macOS, named system images. Instances can be resized, cropped and converted back.

Sources: [shell/common/api/electron_api_native_image.cc:341-400](repo://shell/common/api/electron_api_native_image.cc#L341-L400), [shell/common/api/electron_api_native_image.cc:438-524](repo://shell/common/api/electron_api_native_image.cc#L438-L524), [shell/common/api/electron_api_native_image.cc:552-575](repo://shell/common/api/electron_api_native_image.cc#L552-L575)

### shell

`shell.openExternal` and `openPath` hand URLs and paths to the OS default handler and return promises; `trashItem` moves a file to the trash; `writeShortcutLink` creates Windows `.lnk` files. The module is common, so preload scripts can use it too.

Sources: [shell/common/api/electron_api_shell.cc:58-120](repo://shell/common/api/electron_api_shell.cc#L58-L120), [lib/common/api/module-list.ts:1-5](repo://lib/common/api/module-list.ts#L1-L5)
