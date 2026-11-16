---
title: "Native UI and OS Integration Modules"
---
## Overview

Many `electron` modules exist only to reach something the operating system owns: menus, the tray, dialogs, notifications, the clipboard, power events, the update mechanism. They share one shape. A cross-platform `electron_api_<name>.cc` holds the binding and the shared logic, and platform differences live in neighbouring files that the build includes per target: `_mac.mm`, `_win.cc`, `_linux.cc` or a toolkit-based `_views.cc`. A TypeScript wrapper in `lib/` adds validation and bookkeeping (see [[Module Loading and Linked Bindings]]). This page says what each module is for and where its platform code is; the classes themselves follow the conventions in [[Gin Helpers, Converters and Wrappables]].

Sources: [filenames.gni:24-25](repo://filenames.gni#L24-L25), [filenames.gni:73-76](repo://filenames.gni#L73-L76), [filenames.gni:122-134](repo://filenames.gni#L122-L134), [filenames.gni:210-214](repo://filenames.gni#L210-L214)

`filenames.gni` has the matching lists: `lib_sources_linux`, `lib_sources_win`, `lib_sources_mac`, `lib_sources_views` (shared by Windows and Linux), plus the common `lib_sources`. For example the power monitor has `electron_api_power_monitor.cc` in the common list, `_mac.mm` in the Mac list, `_win.cc` in the Windows list and `power_observer_linux.cc` in the Linux list. How a build uses these lists is in [[Build System]].

Sources: [filenames.gni:24-30](repo://filenames.gni#L24-L30), [filenames.gni:73-76](repo://filenames.gni#L73-L76), [filenames.gni:122-134](repo://filenames.gni#L122-L134), [filenames.gni:286-287](repo://filenames.gni#L286-L287)

## Menus and the tray

**Menu and MenuItem.** `Menu` is a native class with a JavaScript layer. `lib/browser/api/menu.ts` keeps the item list, a `commandsMap` from command ids to `MenuItem`s and radio `groupsMap`; the native side asks back through `_isCommandIdChecked`, `_isCommandIdEnabled`, `_getAcceleratorForCommandId` and `_executeCommand`, which runs an item's `click` with the focused window and web contents. `_menuWillShow` makes sure each radio group has one checked item. The platform class is chosen at link time: `Menu::New` is defined both in `electron_api_menu_views.cc` (returning a `MenuViews` with `PopupAt` on top of a `MenuRunner`) and in `electron_api_menu_mac.mm` (a `MenuMac`). On macOS the binding also exports `setApplicationMenu` and `sendActionToFirstResponder`.

Sources: [lib/browser/api/menu.ts:6-67](repo://lib/browser/api/menu.ts#L6-L67), [shell/browser/api/electron_api_menu_views.cc:19-90](repo://shell/browser/api/electron_api_menu_views.cc#L19-L90), [shell/browser/api/electron_api_menu_mac.mm:50-52](repo://shell/browser/api/electron_api_menu_mac.mm#L50-L52), [shell/browser/api/electron_api_menu_mac.mm:291](repo://shell/browser/api/electron_api_menu_mac.mm#L291-L291), [shell/browser/api/electron_api_menu.cc:324-340](repo://shell/browser/api/electron_api_menu.cc#L324-L340)

**Tray.** `Tray` is the class used in [[Gin Helpers, Converters and Wrappables]] as the worked example: a pinned, constructible, event-emitting object around a `TrayIcon`. `TrayIcon::Create` has three definitions, `tray_icon_cocoa.mm` (macOS status item), `tray_icon_win.cc` (notification-area icon) and `tray_icon_linux.cc`, and the Tray methods check that the icon still exists, throwing "Tray is destroyed" otherwise.

Sources: [shell/browser/ui/tray_icon_cocoa.mm:433](repo://shell/browser/ui/tray_icon_cocoa.mm#L433-L433), [shell/browser/ui/tray_icon_win.cc:11](repo://shell/browser/ui/tray_icon_win.cc#L11-L11), [shell/browser/ui/tray_icon_linux.cc:115](repo://shell/browser/ui/tray_icon_linux.cc#L115-L115), [shell/browser/api/electron_api_tray.cc:400-412](repo://shell/browser/api/electron_api_tray.cc#L400-L412)

## Dialogs and notifications

**dialog.** `lib/browser/api/dialog.ts` validates options and then calls native functions; the native `file_dialog::ShowOpenDialog` and `ShowSaveDialog` come in per-platform files (`file_dialog_mac.mm`, `file_dialog_win.cc`, `file_dialog_linux.cc` and a portal variant `file_dialog_linux_portal.cc`), and message boxes in `message_box_mac.mm`, `message_box_win.cc` and `message_box_gtk.cc`. Asynchronous variants return a `gin_helper::Promise`, the synchronous ones return the result directly. The worked path from JavaScript to native is in [[Module Loading and Linked Bindings]].

Sources: [shell/browser/ui/file_dialog_mac.mm:1-5](repo://shell/browser/ui/file_dialog_mac.mm#L1-L5), [shell/browser/ui/file_dialog_win.cc:1-5](repo://shell/browser/ui/file_dialog_win.cc#L1-L5), [shell/browser/ui/file_dialog_linux.cc:1-5](repo://shell/browser/ui/file_dialog_linux.cc#L1-L5), [shell/browser/ui/file_dialog_linux_portal.cc:1-5](repo://shell/browser/ui/file_dialog_linux_portal.cc#L1-L5), [shell/browser/ui/message_box_gtk.cc:1-5](repo://shell/browser/ui/message_box_gtk.cc#L1-L5), [shell/browser/api/electron_api_dialog.cc:79-111](repo://shell/browser/api/electron_api_dialog.cc#L79-L111), [lib/browser/api/dialog.ts:76-112](repo://lib/browser/api/dialog.ts#L76-L112)

**Notification.** A `Notification` object builds a notification and asks a `NotificationPresenter` to show it. The presenter is created lazily by `ElectronBrowserClient::GetNotificationPresenter`, and `NotificationPresenter::Create` is defined once per platform: `notification_presenter_mac.mm`, `notification_presenter_win.cc` (toasts) and `notification_presenter_linux.cc` (libnotify). The class emits `show`, `click`, `reply`, `action`, `failed` and `close` back to JavaScript. The web `Notification` API goes through `PlatformNotificationService` and the same presenter.

Sources: [shell/browser/notifications/notification_presenter.h:19-47](repo://shell/browser/notifications/notification_presenter.h#L19-L47), [shell/browser/electron_browser_client.cc:980-983](repo://shell/browser/electron_browser_client.cc#L980-L983), [shell/browser/api/electron_api_notification.cc:142-201](repo://shell/browser/api/electron_api_notification.cc#L142-L201), [shell/browser/notifications/platform_notification_service.cc:92](repo://shell/browser/notifications/platform_notification_service.cc#L92-L92)

## Data and files

**clipboard.** One cross-platform `electron_api_clipboard.cc` exposes `read`/`write` for text, RTF, HTML, bookmarks, images, buffers and find text, plus `availableFormats`, `has` and `clear`, with `electron_api_clipboard_mac.mm` for the Mac-only parts. It is in the common bindings, so it also runs in renderers; sandboxed renderers reach the platform pieces through an allow-listed internal IPC (see [[IPC Messaging]]).

Sources: [shell/common/api/electron_api_clipboard.cc:299-320](repo://shell/common/api/electron_api_clipboard.cc#L299-L320), [lib/browser/rpc-server.ts:32-50](repo://lib/browser/rpc-server.ts#L32-L50), [shell/common/node_bindings.cc:89-98](repo://shell/common/node_bindings.cc#L89-L98)

**nativeImage.** `NativeImage` wraps a `gfx::Image` and is available in every process. Its prototype has conversions (`toPNG`, `toJPEG`, `toBitmap`, `toDataURL`), geometry (`getSize`, `resize`, `crop`, `getAspectRatio`), `addRepresentation` for multiple scale factors, and template-image support for macOS; the module has constructors such as `createFromPath`, `createFromBuffer`, `createFromDataURL` and `createThumbnailFromPath`. Platform-specific pieces live in `electron_api_native_image_mac.mm` and `_win.cc`.

Sources: [shell/common/api/electron_api_native_image.cc:588-640](repo://shell/common/api/electron_api_native_image.cc#L588-L640), [filenames.gni:114](repo://filenames.gni#L114-L114), [filenames.gni:195](repo://filenames.gni#L195-L195)

**shell.** `shell` holds five functions that defer to `platform_util`, which has one implementation each in `platform_util_linux.cc`, `platform_util_mac.mm` and `platform_util_win.cc`: `showItemInFolder`, `openPath`, `openExternal`, `trashItem` and `beep`, plus `writeShortcutLink` and `readShortcutLink` for Windows shortcuts.

Sources: [shell/common/api/electron_api_shell.cc:178-185](repo://shell/common/api/electron_api_shell.cc#L178-L185), [shell/common/platform_util.h:20-72](repo://shell/common/platform_util.h#L20-L72)

## System state and input

**powerMonitor.** Created with `createPowerMonitor`, it emits `suspend`, `resume`, `on-ac` and `on-battery`, and a `shutdown` event that can be prevented; `setListeningForShutdown` enables the latter. Module functions answer `getSystemIdleState`, `getSystemIdleTime`, `getCurrentThermalState` and `isOnBatteryPower`. Platform notifications arrive from `electron_api_power_monitor_mac.mm`, `_win.cc` and the Linux `power_observer_linux.cc`.

Sources: [shell/browser/api/electron_api_power_monitor.cc:90-113](repo://shell/browser/api/electron_api_power_monitor.cc#L90-L113), [shell/browser/api/electron_api_power_monitor.cc:158-209](repo://shell/browser/api/electron_api_power_monitor.cc#L158-L209)

**systemPreferences and nativeTheme.** `systemPreferences` exposes `getColor`, `getAccentColor`, media access status, and on macOS the `NSUserDefaults` and distributed-notification calls (`getUserDefault`, `postNotification`, `subscribeNotification`, ...); `system-preferences.ts` only adds `effectiveAppearance` and a deprecation shim. It is also registered in utility processes. `nativeTheme` is a property surface: `shouldUseDarkColors`, `themeSource`, `shouldUseHighContrastColors`, `inForcedColorsMode` and a few others.

Sources: [shell/browser/api/electron_api_system_preferences.cc:39-87](repo://shell/browser/api/electron_api_system_preferences.cc#L39-L87), [lib/browser/api/system-preferences.ts:1-23](repo://lib/browser/api/system-preferences.ts#L1-L23), [shell/browser/api/electron_api_native_theme.cc:112-122](repo://shell/browser/api/electron_api_native_theme.cc#L112-L122), [shell/common/node_bindings.cc:107-111](repo://shell/common/node_bindings.cc#L107-L111)

**globalShortcut.** Wraps Chromium's `GlobalAcceleratorListener`: `register`, `registerAll`, `unregister`, `unregisterAll` and `isRegistered`. A callback map keyed by accelerator is consulted in `OnKeyPressed`; the code has a separate check that refuses to register a media key for an untrusted client.

Sources: [shell/browser/api/electron_api_global_shortcut.cc:36-104](repo://shell/browser/api/electron_api_global_shortcut.cc#L36-L104), [shell/browser/api/electron_api_global_shortcut.cc:232-236](repo://shell/browser/api/electron_api_global_shortcut.cc#L232-L236)

**screen.** Display queries (`getPrimaryDisplay`, `getAllDisplays`, `getDisplayNearestPoint`, `getDisplayMatching`, `getCursorScreenPoint`) and conversions between screen and DIP coordinates for points and rectangles. The binding exports `createScreen` rather than the object, so it is created after app ready.

Sources: [shell/browser/api/electron_api_screen.cc:197-228](repo://shell/browser/api/electron_api_screen.cc#L197-L228)

## Updates and secrets

**autoUpdater.** The module picks an implementation by platform in `lib/browser/api/auto-updater.ts`: on Windows a pure TypeScript `AutoUpdater` built on Squirrel (`squirrel-update-win.ts`, with `quitAndInstall` starting the Squirrel process and quitting), otherwise the native binding. The native `auto_updater.cc` is a stub that returns empty values on every platform but non-MAS macOS, where `auto_updater_mac.mm` wraps Squirrel.Mac; Linux has no updater.

Sources: [lib/browser/api/auto-updater.ts:1-5](repo://lib/browser/api/auto-updater.ts#L1-L5), [lib/browser/api/auto-updater/auto-updater-win.ts:7-50](repo://lib/browser/api/auto-updater/auto-updater-win.ts#L7-L50), [shell/browser/auto_updater.cc:22-37](repo://shell/browser/auto_updater.cc#L22-L37)

**safeStorage.** Encrypts strings with the OS credential store through Chromium's `OSCrypt`: `encryptString`, `decryptString`, `isEncryptionAvailable`, and Linux-only `getSelectedStorageBackend` and `setUsePlainTextEncryption`. It must not be used before the app is ready (on Linux availability returns false before ready, because the code notes a crash otherwise), and encrypt throws if encryption is unavailable.

Sources: [shell/browser/api/electron_api_safe_storage.cc:23-62](repo://shell/browser/api/electron_api_safe_storage.cc#L23-L62), [shell/browser/api/electron_api_safe_storage.cc:131-146](repo://shell/browser/api/electron_api_safe_storage.cc#L131-L146)
