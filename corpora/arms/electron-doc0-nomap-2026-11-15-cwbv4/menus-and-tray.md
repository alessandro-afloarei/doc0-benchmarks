---
title: "Menus, Accelerators and Tray"
---
## Overview

Electron's menus are split between a JavaScript layer that owns the items and their behaviour and a C++ layer that owns the native model and draws it. `Menu` and `MenuItem` live mostly in `lib/browser/api`, while the native `api::Menu` wraps an `ElectronMenuModel`, a subclass of Chromium's `ui::SimpleMenuModel`. Whenever the native side needs to know something about an item (is it checked, enabled, what is its accelerator) or an item is clicked, it calls back into JavaScript. The same model is used for the application menu, window menus, context menus and tray menus. This page also covers how accelerator strings are parsed, keyboard shortcuts inside windows, system-wide `globalShortcut`, and the `Tray` icon. How native objects call JavaScript in general is described in [[Native API Bindings with gin]].

Sources: [lib/browser/api/menu.ts:1-60](repo://lib/browser/api/menu.ts#L1-L60), [shell/browser/api/electron_api_menu.cc:53-150](repo://shell/browser/api/electron_api_menu.cc#L53-L150)

## Building a menu

### Menu.buildFromTemplate

`buildFromTemplate` checks that every template entry has a `label`, a `role` or `type: 'separator'`, sorts the items, collapses adjacent separators and removes leading and trailing ones (hidden items are left alone), and appends a `MenuItem` for each entry. Sorting honours `before`, `after`, `beforeGroupContaining` and `afterGroupContaining` hints on items, applied recursively to submenus.

Sources: [lib/browser/api/menu.ts:188-261](repo://lib/browser/api/menu.ts#L188-L261), [lib/browser/api/menu-utils.ts:74-130](repo://lib/browser/api/menu-utils.ts#L74-L130)

### MenuItem

The `MenuItem` constructor copies the options, lowercases `role`, fills a role's default submenu, builds a `Menu` from a submenu template, and infers `type: 'submenu'`. It then freezes `type`, `role`, `accelerator`, `icon` and `submenu` as read-only properties, defaults `label` (from the role), `enabled`, `visible`, `checked` and `registerAccelerator`, and assigns a unique `commandId`. Unknown types throw.

Sources: [lib/browser/api/menu-item.ts:5-45](repo://lib/browser/api/menu-item.ts#L5-L45), [lib/browser/api/menu-item.ts:74-98](repo://lib/browser/api/menu-item.ts#L74-L98)

The item's `click` wrapper flips `checked` for checkbox and radio items (unless the role controls the check state), then runs the role's built-in action if it has one, otherwise the user's `click(menuItem, window, event)`, or on macOS sends an Objective-C `selector` to the first responder.

Sources: [lib/browser/api/menu-item.ts:56-71](repo://lib/browser/api/menu-item.ts#L56-L71)

### Inserting into the native model

`Menu.insert` calls the native insert method for the item's type (`insertItem`, `insertCheckItem`, `insertRadioItem`, `insertSeparator`, `insertSubMenu`), then sets the sublabel, tooltip, icon, role and custom type, records the item in `commandsMap` by command ID, and gives the item a back-reference to the menu. Radio items get a group ID shared by consecutive radio items between separators, and their `checked` setter unchecks the rest of the group.

Sources: [lib/browser/api/menu.ts:127-156](repo://lib/browser/api/menu.ts#L127-L156), [lib/browser/api/menu.ts:263-299](repo://lib/browser/api/menu.ts#L263-L299)

## The native model and its delegate

`api::Menu` creates an `ElectronMenuModel` with itself as the delegate. Chromium's menu code queries the delegate, and each query is forwarded to a JavaScript method on the menu object by command ID:

Sources: [shell/browser/api/electron_api_menu.cc:53-91](repo://shell/browser/api/electron_api_menu.cc#L53-L91)

| Native delegate call | JavaScript method | Answer from |
| --- | --- | --- |
| `IsCommandIdChecked` | `_isCommandIdChecked` | `item.getCheckStatus()` (role state for roles like `togglefullscreen`) |
| `IsCommandIdEnabled`, `IsCommandIdVisible` | `_isCommandIdEnabled`, `_isCommandIdVisible` | `item.enabled`, `item.visible` |
| `GetAcceleratorForCommandIdWithParams` | `_getAcceleratorForCommandId` | `item.accelerator`, or the role's default |
| `ShouldRegisterAcceleratorForCommandId` | `_shouldRegisterAcceleratorForCommandId` | `item.registerAccelerator` |
| `ExecuteCommand` | `_executeCommand` | `item.click(event, focusedWindow, focusedWebContents)` |
| `OnMenuWillShow` | `_menuWillShow` | Ensures each radio group has one checked item |

Sources: [shell/browser/api/electron_api_menu.cc:93-150](repo://shell/browser/api/electron_api_menu.cc#L93-L150), [lib/browser/api/menu.ts:21-66](repo://lib/browser/api/menu.ts#L21-L66)

Because state is read at display time, changing `item.enabled` or `item.checked` in JavaScript is reflected the next time the menu opens. While a menu is open the native object pins itself and emits `menu-will-show`; on close it unpins and emits `menu-will-close`.

Sources: [shell/browser/api/electron_api_menu.cc:270-278](repo://shell/browser/api/electron_api_menu.cc#L270-L278)

## Roles

`menu-item-roles.ts` defines each role: a label (some computed, like "About <app name>"), a default accelerator, whether it registers that accelerator, and what it does, as an `appMethod`, a `windowMethod` on the focused window or a `webContentsMethod` on the focused page. `copy`, `cut` and `paste` call the page's editing commands and do not register their accelerators, leaving the keystrokes to the page. Composite roles (`appMenu`, `fileMenu`, `editMenu`, `viewMenu`, `windowMenu`, `shareMenu`) supply whole default submenus, adjusted per platform.

Sources: [lib/browser/api/menu-item-roles.ts:1-60](repo://lib/browser/api/menu-item-roles.ts#L1-L60), [lib/browser/api/menu-item-roles.ts:342-397](repo://lib/browser/api/menu-item-roles.ts#L342-L397)

`execute` runs the app method, else the window method if there is a focused window, else the web contents method if there is a focused page, and returns whether it did anything. On macOS most roles map to native Cocoa selectors and are not executed in JavaScript; `canExecuteRole` checks the `nonNativeMacOSRole` flag.

Sources: [lib/browser/api/menu-item-roles.ts:325-336](repo://lib/browser/api/menu-item-roles.ts#L325-L336), [lib/browser/api/menu-item-roles.ts:376-397](repo://lib/browser/api/menu-item-roles.ts#L376-L397)

## Showing menus

### The application menu

`Menu.setApplicationMenu` stores the menu and records that the app set one, which suppresses the default menu from [[Main Process Bootstrap]]. On macOS it calls the native `setApplicationMenu`, which builds an `ElectronMenuController` for the main menu bar. On Windows and Linux there is no global menu bar, so it calls `setMenu` on every existing window, and new windows copy the application menu in their `_init` ([[Windows and Views]]).

Sources: [lib/browser/api/menu.ts:171-186](repo://lib/browser/api/menu.ts#L171-L186), [shell/browser/api/electron_api_menu_mac.mm:263-270](repo://shell/browser/api/electron_api_menu_mac.mm#L263-L270), [lib/browser/api/base-window.ts:10-19](repo://lib/browser/api/base-window.ts#L10-L19)

### Popups and context menus

`menu.popup(options)` defaults the position and source type, picks the given window or the focused one (or the first window, or throws if there is none), and calls the native `popupAt`. `MenuViews::PopupAt` runs a Chromium `views::MenuRunner` as a context menu anchored to the window's widget, one runner per window; `MenuMac::PopupAt` builds an `ElectronMenuController` and shows a Cocoa menu. `closePopup` closes the runner for one window or all of them.

Sources: [lib/browser/api/menu.ts:68-108](repo://lib/browser/api/menu.ts#L68-L108), [shell/browser/api/electron_api_menu_views.cc:23-85](repo://shell/browser/api/electron_api_menu_views.cc#L23-L85), [shell/browser/api/electron_api_menu_mac.mm:54-130](repo://shell/browser/api/electron_api_menu_mac.mm#L54-L130)

Electron shows no context menu for pages by itself: right-clicking a page emits `context-menu` on its `webContents` with the context parameters, and the app is expected to build and pop up a menu.

Sources: [shell/browser/api/electron_api_web_contents.cc:1545-1550](repo://shell/browser/api/electron_api_web_contents.cc#L1545-L1550)

## Accelerators

### Parsing

Accelerator strings such as `CommandOrControl+Shift+Z` are parsed by `accelerator_util::StringToAccelerator`. The string must be ASCII; it is split on `+`, each token is mapped to a key code, `Shift`, `Control`, `Alt`, `Command` and `AltGr` tokens become modifiers, a token that implies Shift (a shifted character) adds the Shift modifier, and the last non-modifier token is the key. A string without a valid key is rejected with a warning.

Sources: [shell/browser/ui/accelerator_util.cc:20-72](repo://shell/browser/ui/accelerator_util.cc#L20-L72)

### Menu accelerators in windows

On Windows and Linux, when a window's menu is set, its `RootView` builds an accelerator table by walking the menu model recursively and collecting each item that should register its accelerator, and registers every accelerator with the window's focus manager. A matching key press activates the item if it is enabled, which ends in `_executeCommand`. On macOS key equivalents are handled by the Cocoa menu itself.

Sources: [shell/browser/ui/views/root_view.cc:170-195](repo://shell/browser/ui/views/root_view.cc#L170-L195), [shell/browser/ui/accelerator_util.cc:74-107](repo://shell/browser/ui/accelerator_util.cc#L74-L107)

### globalShortcut

`globalShortcut` registers system-wide shortcuts that fire even when the app is not focused. All its methods throw before `ready`. `Register` goes through Chromium's `ui::GlobalAcceleratorListener`. On macOS, media keys can only be registered by an app trusted for accessibility, and registering one turns off Chromium's internal media-key handling until the last media key is unregistered. On Linux desktops where registration is handled externally (through the desktop portal), each shortcut is registered as a separate fake extension command, keyed by a per-installation UUID stored in the default session's preferences so the desktop can remember the user's bindings across runs. When the listener reports a press, the callback stored for that accelerator runs.

Sources: [shell/browser/api/electron_api_global_shortcut.cc:33-70](repo://shell/browser/api/electron_api_global_shortcut.cc#L33-L70), [shell/browser/api/electron_api_global_shortcut.cc:104-220](repo://shell/browser/api/electron_api_global_shortcut.cc#L104-L220)

## Tray

`new Tray(image, guid?)` requires the app to be ready and creates a platform `TrayIcon`; the object is pinned until `destroy()` so the icon does not vanish when the app drops its reference. Clicks arrive as `click`, `double-click` and `right-click` events with the keyboard modifiers and the icon bounds.

Sources: [shell/browser/api/electron_api_tray.cc:53-120](repo://shell/browser/api/electron_api_tray.cc#L53-L120), [shell/browser/api/electron_api_tray.cc:188-196](repo://shell/browser/api/electron_api_tray.cc#L188-L196)

| Platform | Implementation |
| --- | --- |
| Windows | A notify icon created by a process-wide `NotifyIconHost`, which receives the optional GUID |
| macOS | `TrayIconCocoa`, a status item; the GUID becomes the autosave name |
| Linux | `TrayIconLinux`, which uses the D-Bus StatusNotifierItem protocol and falls back to a GTK status icon, then to none, if that fails |

Sources: [shell/browser/ui/tray_icon_win.cc:11-14](repo://shell/browser/ui/tray_icon_win.cc#L11-L14), [shell/browser/ui/tray_icon_cocoa.mm:433-435](repo://shell/browser/ui/tray_icon_cocoa.mm#L433-L435), [shell/browser/ui/tray_icon_linux.cc:30-117](repo://shell/browser/ui/tray_icon_linux.cc#L30-L117), [shell/browser/api/electron_api_tray.cc:53-61](repo://shell/browser/api/electron_api_tray.cc#L53-L61)

`setContextMenu(menu)` keeps a reference to the `Menu` and hands its `ElectronMenuModel` to the platform icon, which shows it on the platform's usual gesture; `popUpContextMenu` shows a menu on demand, and `displayBalloon` shows a Windows balloon notification. On Linux, `lib/browser/init.ts` rewrites `XDG_CURRENT_DESKTOP` on desktops that support app indicators so Chromium picks the indicator implementation.

Sources: [shell/browser/api/electron_api_tray.cc:293-388](repo://shell/browser/api/electron_api_tray.cc#L293-L388), [lib/browser/init.ts:165-184](repo://lib/browser/init.ts#L165-L184)
