---
title: "Menus, Tray and Dialogs"
---
## Overview

Electron's native UI modules let the main process show operating-system UI that is not a web page: application and context menus, tray icons, file and message dialogs, and desktop notifications. Each follows the pattern described in [[Native Bindings and the gin_helper Layer]]: a TypeScript module in `lib/browser/api` validates arguments and adds JS-only behaviour, a C++ class in `shell/browser/api` is the bound object, and a per-platform implementation in `shell/browser/ui` or `shell/browser/notifications` talks to Cocoa, Win32 or GTK and D-Bus. All of them refuse to work before `ready`.

Sources: [lib/browser/api/menu.ts:1-8](repo://lib/browser/api/menu.ts#L1-L8), [lib/browser/api/dialog.ts:54-58](repo://lib/browser/api/dialog.ts#L54-L58), [shell/browser/api/electron_api_tray.cc:65-94](repo://shell/browser/api/electron_api_tray.cc#L65-L94), [shell/browser/api/electron_api_notification.cc:80-89](repo://shell/browser/api/electron_api_notification.cc#L80-L89)

| Module | JS layer | Native class | Platform code |
| --- | --- | --- | --- |
| `Menu`, `MenuItem` | `menu.ts`, `menu-item.ts`, `menu-item-roles.ts` | `api::Menu` over `ElectronMenuModel` | `MenuViews` (views `MenuRunner`), `MenuMac` (Cocoa) |
| `Tray` | `tray.ts` (re-export) | `api::Tray` | `TrayIcon` subclasses: Cocoa, Windows `NotifyIcon`, Linux D-Bus status icon |
| `dialog` | `dialog.ts` | free functions in `electron_api_dialog.cc` | `file_dialog_*`, `message_box_*` per platform |
| `Notification` | `notification.ts` (re-export) | `api::Notification` | `NotificationPresenter` per platform |

Sources: [shell/browser/api/electron_api_menu.cc:55-67](repo://shell/browser/api/electron_api_menu.cc#L55-L67), [shell/browser/api/electron_api_menu_views.cc:23-63](repo://shell/browser/api/electron_api_menu_views.cc#L23-L63), [shell/browser/api/electron_api_menu_mac.mm:54](repo://shell/browser/api/electron_api_menu_mac.mm#L54), [shell/browser/ui/tray_icon_cocoa.mm:433](repo://shell/browser/ui/tray_icon_cocoa.mm#L433), [shell/browser/ui/tray_icon_win.cc:11](repo://shell/browser/ui/tray_icon_win.cc#L11), [shell/browser/ui/tray_icon_linux.cc:33-37](repo://shell/browser/ui/tray_icon_linux.cc#L33-L37), [shell/browser/api/electron_api_dialog.cc:89-111](repo://shell/browser/api/electron_api_dialog.cc#L89-L111), [shell/browser/notifications/linux/notification_presenter_linux.cc:13](repo://shell/browser/notifications/linux/notification_presenter_linux.cc#L13)

## Menu and MenuItem

### State lives in JS

The native `Menu` owns an `ElectronMenuModel` (a `ui::SimpleMenuModel`) holding only structure: command ids, labels, item kinds and submenus. Everything the toolkit asks about an item while drawing (is it checked, enabled, visible, what is its accelerator) is answered by calling back into JS: `IsCommandIdChecked` calls `_isCommandIdChecked`, and so on. A click calls `_executeCommand` with an event built from the modifier flags, and opening a menu calls `_menuWillShow`. So changing `item.enabled` in JS takes effect the next time the menu is drawn, without touching the model.

Sources: [shell/browser/api/electron_api_menu.cc:55-150](repo://shell/browser/api/electron_api_menu.cc#L55-L150), [lib/browser/api/menu.ts:15-67](repo://lib/browser/api/menu.ts#L15-L67)

### Building a menu

`Menu.buildFromTemplate` requires an array whose items each have `label`, `role` or `type: 'separator'`. It sorts items by their `before`, `after`, `beforeGroupContaining` and `afterGroupContaining` hints (`menu-utils.ts`), folds adjacent separators and drops leading and trailing ones (ignoring invisible items), then appends a `MenuItem` for each entry. `insert` checks the position, calls the native insert for the item's type (`insertItem`, `insertCheckItem`, `insertRadioItem`, `insertSeparator`, `insertSubMenu`), sets sublabel, tooltip, icon, role and `palette`/`header` custom types, and records the item in `commandsMap` by command id.

Sources: [lib/browser/api/menu.ts:123-156](repo://lib/browser/api/menu.ts#L123-L156), [lib/browser/api/menu.ts:190-265](repo://lib/browser/api/menu.ts#L190-L265), [lib/browser/api/menu.ts:267-299](repo://lib/browser/api/menu.ts#L267-L299)

Radio items are grouped by scanning back (or forward) to the nearest radio item before a separator; a new group gets a fresh id. Each radio item's `checked` becomes an accessor that unchecks the rest of its group when set, and before a menu opens every group without a checked item checks its first.

Sources: [lib/browser/api/menu.ts:234-249](repo://lib/browser/api/menu.ts#L234-L249), [lib/browser/api/menu.ts:275-296](repo://lib/browser/api/menu.ts#L275-L296), [lib/browser/api/menu.ts:61-67](repo://lib/browser/api/menu.ts#L61-L67)

### MenuItem

`new MenuItem(options)` keeps unknown fields, lowercases `role`, fills a role's default submenu, converts a template submenu with `buildFromTemplate`, and infers `type: 'submenu'`. `type`, `role`, `accelerator`, `icon`, `submenu` and `commandId` become read-only; `label`, `enabled`, `visible`, `checked` and the others get defaults (the role's label, `true`, and so on). An unknown type throws. On click it toggles checkbox and radio items itself (unless the role owns its check state), then runs the role if one applies, otherwise the user's `click(item, focusedWindow, event)`, or on macOS sends `selector` to the first responder.

Sources: [lib/browser/api/menu-item.ts:7-98](repo://lib/browser/api/menu-item.ts#L7-L98)

### Roles

`menu-item-roles.ts` defines 42 roles. Each role may give a label, a default accelerator, whether to register that accelerator (`copy`, `cut` and `paste` do not, so the page's own handling wins), a default submenu (`appMenu`, `fileMenu`, `editMenu`, `viewMenu`, `windowMenu`, `shareMenu`), and an action on the app, the focused window or the focused `webContents`. `execute` runs the first action that applies and reports whether it did. On macOS most roles are handled natively by Cocoa, so only roles marked `nonNativeMacOSRole` run JS there.

Sources: [lib/browser/api/menu-item-roles.ts:7-60](repo://lib/browser/api/menu-item-roles.ts#L7-L60), [lib/browser/api/menu-item-roles.ts:302-397](repo://lib/browser/api/menu-item-roles.ts#L302-L397)

### Application menu and the default menu

`Menu.setApplicationMenu` stores the menu and marks that the app set one. On macOS it calls `_callMenuWillShow` across the tree and installs the menu as the app's menu bar; elsewhere it calls `setMenu` on every window, and `BaseWindow._init` applies it to windows created later ([[Windows, Views and WebContentsView]]). `app.applicationMenu` is a JS property over the same getter and setter.

Sources: [lib/browser/api/menu.ts:165-188](repo://lib/browser/api/menu.ts#L165-L188), [lib/browser/api/base-window.ts:10-19](repo://lib/browser/api/base-window.ts#L10-L19), [lib/browser/api/app.ts:50-59](repo://lib/browser/api/app.ts#L50-L59)

`lib/browser/init.ts` installs `setDefaultApplicationMenu` on `will-finish-launching`, so it runs before any window exists. Unless the app already set a menu, it builds one from roles (the app menu on macOS, then File, Edit, View, Window), plus a Help menu with links to the Electron website, docs, Discord and issue tracker, left empty in packaged apps.

Sources: [lib/browser/init.ts:193-199](repo://lib/browser/init.ts#L193-L199), [lib/browser/default-menu.ts:1-60](repo://lib/browser/default-menu.ts#L1-L60)

### Context menus

`menu.popup(options)` defaults the position to the cursor (`-1, -1`) and the source type to `mouse`, and picks the given window, the focused one, or the first window, throwing `Cannot open Menu without a BaseWindow present` when there is none. On Windows and Linux, `MenuViews::PopupAt` converts window-relative coordinates to screen coordinates, binds a reference to the menu's wrapper into the close callback so the menu cannot be garbage-collected while open, and runs a `views::MenuRunner` per window id; `closePopup` without a window closes all of the menu's runners.

Sources: [lib/browser/api/menu.ts:69-108](repo://lib/browser/api/menu.ts#L69-L108), [shell/browser/api/electron_api_menu_views.cc:23-63](repo://shell/browser/api/electron_api_menu_views.cc#L23-L63), [shell/browser/api/electron_api_menu.cc:152-167](repo://shell/browser/api/electron_api_menu.cc#L152-L167)

## Tray

`Tray` is the binding example used on [[Native Bindings and the gin_helper Layer]]: a constructible event emitter whose `New` throws before `ready`, validates an optional GUID, and pins the object so a tray icon survives without a JS reference. The constructor creates the platform `TrayIcon` (with the GUID, when given, as its auto-save name), sets the image and observes the icon.

Sources: [shell/browser/api/electron_api_tray.cc:53-94](repo://shell/browser/api/electron_api_tray.cc#L53-L94), [lib/browser/api/tray.ts:1-3](repo://lib/browser/api/tray.ts#L1-L3)

Icon events become JS events: `click`, `double-click`, `right-click` and `middle-click` with bounds, `mouse-enter`, `mouse-leave` and `mouse-move` with a location, `drop`, `drop-files` and `drop-text`, and the Windows balloon events. `setContextMenu` keeps a strong reference to the `Menu` and hands its model to the icon. `destroy()` unpins the object, drops the menu and deletes the icon; any later call throws `Tray is destroyed`.

Sources: [shell/browser/api/electron_api_tray.cc:96-160](repo://shell/browser/api/electron_api_tray.cc#L96-L160), [shell/browser/api/electron_api_tray.cc:188-196](repo://shell/browser/api/electron_api_tray.cc#L188-L196), [shell/browser/api/electron_api_tray.cc:373-412](repo://shell/browser/api/electron_api_tray.cc#L373-L412)

On Linux, `TrayIconLinux` uses a D-Bus status icon (`StatusIconLinuxDbus`) and hands it the highest-resolution image representation at scale 1, because status icon implementations want pixel coordinates. `lib/browser/init.ts` sets `XDG_CURRENT_DESKTOP` to `Unity` on desktops known to support app indicators (Pantheon, Unity, Pop and Ubuntu sessions), keeping the original in `ORIGINAL_XDG_CURRENT_DESKTOP`.

Sources: [shell/browser/ui/tray_icon_linux.cc:20-50](repo://shell/browser/ui/tray_icon_linux.cc#L20-L50), [lib/browser/init.ts:165-184](repo://lib/browser/init.ts#L165-L184)

## dialog

### Validation and the property bit masks

Every `dialog` function first throws `dialog module can only be used after app is ready`, accepts an optional leading `BaseWindow` (the dialog is then modal to it), and type-checks its options. Open and save dialog `properties` arrays become bit masks (`openFile`, `openDirectory`, `multiSelections`, `showHiddenFiles` and others; some flags apply only to macOS or Windows). The defaults are an open dialog titled "Open" with `openFile`, and a save dialog titled "Save".

Sources: [lib/browser/api/dialog.ts:6-24](repo://lib/browser/api/dialog.ts#L6-L24), [lib/browser/api/dialog.ts:54-154](repo://lib/browser/api/dialog.ts#L54-L154), [lib/browser/api/dialog.ts:241-271](repo://lib/browser/api/dialog.ts#L241-L271)

### Message boxes

`showMessageBox` checks `type` (`none`, `info`, `warning`, `error`, `question`), and with `normalizeAccessKeys` rewrites `&` access keys for the platform: removed on macOS, turned into `_` on Linux with existing underscores escaped. When `cancelId` is not given it picks the first button labelled "cancel" or "no", else index 0 (or 1 when `defaultId` is 0). An `AbortSignal` gets an id so aborting calls `_closeMessageBox`; an already aborted signal resolves immediately with the cancel id. `checkboxChecked` without `checkboxLabel` throws.

Sources: [lib/browser/api/dialog.ts:31-52](repo://lib/browser/api/dialog.ts#L31-L52), [lib/browser/api/dialog.ts:156-239](repo://lib/browser/api/dialog.ts#L156-L239)

### Native side

Each dialog has a sync and an async binding. The async forms create a `gin_helper::Promise` and pass it, or a callback that resolves `{ response, checkboxChecked }`, to the platform functions in `file_dialog` and `ShowMessageBox`; the sync forms block and return the paths or button index. `showErrorBox` is a plain native call, and `showCertificateTrustDialog` exists only on macOS and Windows.

Sources: [shell/browser/api/electron_api_dialog.cc:27-111](repo://shell/browser/api/electron_api_dialog.cc#L27-L111), [lib/browser/api/dialog.ts:289-309](repo://lib/browser/api/dialog.ts#L289-L309)

The main process's own uncaught-exception handler uses `dialog.showErrorBox` to report errors in a GUI, as [[Main Process Startup and App Lifecycle]] describes.

Sources: [lib/browser/init.ts:21-38](repo://lib/browser/init.ts#L21-L38)

## Notification

### Creating and showing

`Notification` throws `Cannot create Notification before app is ready` and copies its options (`title`, `subtitle`, `body`, `icon`, `silent`, `hasReply` and `replyPlaceholder`, `urgency`, `timeoutType`, `actions`, `sound`, `closeButtonText`, `toastXml`) into fields that the setters also change. It gets the process-wide `NotificationPresenter` from `ElectronBrowserClient`. `show()` closes any notification this object already showed, asks the presenter to create a new one with a random id, and shows it with the current options.

Sources: [shell/browser/api/electron_api_notification.cc:53-89](repo://shell/browser/api/electron_api_notification.cc#L53-L89), [shell/browser/api/electron_api_notification.cc:167-187](repo://shell/browser/api/electron_api_notification.cc#L167-L187), [lib/browser/api/notification.ts:1-8](repo://lib/browser/api/notification.ts#L1-L8)

### Events and presenters

The native object is the notification's delegate, so platform callbacks become `show`, `click`, `reply`, `action` (with the action index), `close` and `failed` (with an error string). `close()` dismisses a visible notification or removes a dismissed one, and detaches the delegate.

Sources: [shell/browser/api/electron_api_notification.cc:141-177](repo://shell/browser/api/electron_api_notification.cc#L141-L177)

`NotificationPresenter::Create` has one implementation per platform: Cocoa notifications on macOS, Windows toasts, and libnotify on Linux. The same presenters back web pages' HTML5 notifications through Electron's `PlatformNotificationService`.

Sources: [shell/browser/notifications/mac/notification_presenter_mac.mm:20](repo://shell/browser/notifications/mac/notification_presenter_mac.mm#L20), [shell/browser/notifications/win/notification_presenter_win.cc:42](repo://shell/browser/notifications/win/notification_presenter_win.cc#L42), [shell/browser/notifications/linux/notification_presenter_linux.cc:13](repo://shell/browser/notifications/linux/notification_presenter_linux.cc#L13), [shell/browser/notifications/platform_notification_service.cc:92-119](repo://shell/browser/notifications/platform_notification_service.cc#L92-L119)
