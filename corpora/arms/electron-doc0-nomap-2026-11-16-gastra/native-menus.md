---
title: "Native Menus and Commands"
---
## Overview

Electron menus translate declarative templates into native menu entries and route selected command IDs back to application behavior. MenuItem supplies defaults, roles and click handling; Menu owns ordering, native insertion, command lookup and popup placement. A command can act on the focused window or WebContents described in [[Windows and Navigation]], while default application-menu installation occurs during [[Application Startup and Lifecycle]].

Sources: [lib/browser/api/menu.ts:54-59](repo://lib/browser/api/menu.ts#L54-L59), [lib/browser/api/menu.ts:127-155](repo://lib/browser/api/menu.ts#L127-L155), [lib/browser/api/menu.ts:190-212](repo://lib/browser/api/menu.ts#L190-L212), [lib/browser/api/menu-item.ts:7-71](repo://lib/browser/api/menu-item.ts#L7-L71), [lib/browser/init.ts:193-199](repo://lib/browser/init.ts#L193-L199)

## Build a template

`Menu.buildFromTemplate` requires an array. Each item must be a non-null object with its own label or role, or have separator type. The builder sorts the template, removes extra separators, creates a Menu and appends either existing MenuItems or new MenuItem instances. Sorting recurses into array submenus before construction, so nested command groups use the same ordering machinery.

Sources: [lib/browser/api/menu.ts:190-232](repo://lib/browser/api/menu.ts#L190-L232)

A MenuItem preserves extra user fields, lowercases string roles and obtains a role's default submenu when needed. An array submenu becomes another Menu through `buildFromTemplate`; a submenu-typed item without a valid Menu throws. Defaults include enabled and visible true, checked false and role-derived labels and accelerator registration. Every item receives a monotonically assigned command ID used for native dispatch.

Sources: [lib/browser/api/menu-item.ts:7-45](repo://lib/browser/api/menu-item.ts#L7-L45)

The repository's default menu demonstrates composition using roles. It includes an app menu on macOS, followed by file, edit, view, window and help menus. The role definitions provide submenu contents, so the template does not need to reproduce every edit or window command. Unpackaged applications also get help links that are omitted from the packaged help-menu template.

Sources: [lib/browser/default-menu.ts:12-59](repo://lib/browser/default-menu.ts#L12-L59), [lib/browser/api/menu-item.ts:15-18](repo://lib/browser/api/menu-item.ts#L15-L18), [lib/browser/api/menu-item-roles.ts:302-317](repo://lib/browser/api/menu-item-roles.ts#L302-L317)

## Order and insert native entries

The ordering helpers model `before` and `after` relationships as edges between item IDs and perform a depth-first topological sort. Referenced IDs that are absent do not add edges, and encountered cycles are broken by marking visited nodes. Group relationships use `beforeGroupContaining` and `afterGroupContaining`; these refer to the group containing an identified item. This allows command placement to depend on known IDs instead of hard-coded array positions.

Sources: [lib/browser/api/menu-utils.ts:49-72](repo://lib/browser/api/menu-utils.ts#L49-L72), [lib/browser/api/menu-utils.ts:101-151](repo://lib/browser/api/menu-utils.ts#L101-L151)

Menu insertion requires an actual MenuItem and a position between zero and the current item count. The item's type selects the native insertion method, after which sublabel, tooltip, icon, role and special type information are applied. The Menu stores the item in both its ordered array and command-ID map and supplies a read-only back-reference to the owning menu.

Sources: [lib/browser/api/menu.ts:123-156](repo://lib/browser/api/menu.ts#L123-L156), [lib/browser/api/menu.ts:267-299](repo://lib/browser/api/menu.ts#L267-L299)

| Item type | Insertion and behavior |
| --- | --- |
| `normal` | Ordinary native command entry |
| `header` | Ordinary insertion plus custom type configuration |
| `separator` | Native separator without a clickable item command |
| `checkbox` | Native check item with click-time state handling |
| `radio` | Native radio item assigned to a group |
| `submenu` | Nested Menu inserted as a submenu |
| `palette` | Submenu insertion plus custom type configuration |

Sources: [lib/browser/api/menu.ts:138-148](repo://lib/browser/api/menu.ts#L138-L148), [lib/browser/api/menu.ts:267-299](repo://lib/browser/api/menu.ts#L267-L299), [lib/browser/api/menu-item.ts:56-74](repo://lib/browser/api/menu-item.ts#L56-L74)

## Dispatch a command

```mermaid
flowchart TD
  native["Native ExecuteCommand"] --> lookup["Menu._executeCommand looks up command ID"]
  lookup --> context["Find focused window and WebContents"]
  context --> click["MenuItem.click updates checked state"]
  click --> role["Try role implementation"]
  role -->|"handled"| done["Command complete"]
  role -->|"not handled"| user["Call user click callback"]
  role -->|"no callback on macOS"| selector["Send selector to first responder"]
```

Sources: [shell/browser/api/electron_api_menu.cc:139-144](repo://shell/browser/api/electron_api_menu.cc#L139-L144), [lib/browser/api/menu.ts:54-59](repo://lib/browser/api/menu.ts#L54-L59), [lib/browser/api/menu-item.ts:56-71](repo://lib/browser/api/menu-item.ts#L56-L71), [lib/browser/api/menu-item-roles.ts:376-397](repo://lib/browser/api/menu-item-roles.ts#L376-L397)

Role execution tries an application method first, then a window method when a focused window exists, then a WebContents method when focused content exists. Examples include quit, close, copy and reload. On macOS, most roles are handled natively and the JavaScript executor only runs roles marked for non-native handling. If JavaScript role execution returns false, the item invokes the supplied click callback or, on macOS with a selector and no callback, sends an action to the first responder.

Sources: [lib/browser/api/menu-item-roles.ts:31-45](repo://lib/browser/api/menu-item-roles.ts#L31-L45), [lib/browser/api/menu-item-roles.ts:97-121](repo://lib/browser/api/menu-item-roles.ts#L97-L121), [lib/browser/api/menu-item-roles.ts:329-335](repo://lib/browser/api/menu-item-roles.ts#L329-L335), [lib/browser/api/menu-item-roles.ts:376-397](repo://lib/browser/api/menu-item-roles.ts#L376-L397), [lib/browser/api/menu-item.ts:64-70](repo://lib/browser/api/menu-item.ts#L64-L70)

## Preserve checkbox and radio invariants

A checkbox or radio click flips its checked flag unless the role owns the checked status. Radio insertion replaces that flag with a group-aware accessor: assigning it selects that item and clears every other item in the group. Groups are found around separator boundaries. Before a menu is shown, each radio group without a selected member has its first member selected, ensuring that the displayed group has a choice.

Sources: [lib/browser/api/menu-item.ts:56-62](repo://lib/browser/api/menu-item.ts#L56-L62), [lib/browser/api/menu-item.ts:80-83](repo://lib/browser/api/menu-item.ts#L80-L83), [lib/browser/api/menu.ts:61-67](repo://lib/browser/api/menu.ts#L61-L67), [lib/browser/api/menu.ts:234-249](repo://lib/browser/api/menu.ts#L234-L249), [lib/browser/api/menu.ts:275-295](repo://lib/browser/api/menu.ts#L275-L295)

## Install an application menu or open a popup

`setApplicationMenu` records the supplied menu and marks application-menu configuration as explicit. The default-menu builder checks that flag and returns without replacing it. On macOS a non-null menu is passed to the native application-menu binding after menu-will-show callbacks; on other platforms the setter applies the menu to all existing BaseWindows. The cached value is returned by `getApplicationMenu`.

Sources: [lib/browser/api/menu.ts:158-188](repo://lib/browser/api/menu.ts#L158-L188), [lib/browser/default-menu.ts:6-13](repo://lib/browser/default-menu.ts#L6-L13)

`popup` validates an options object and normalizes missing coordinates and positioning item to -1, with mouse as the default source type. It uses the supplied window when present in the current window list, otherwise the focused window, otherwise the first available window. With no window it throws. The selected window, optional frame and callback reach the native popup method. `closePopup(window)` closes that window's runner; omitting a valid BaseWindow closes all runners belonging to the menu.

Sources: [lib/browser/api/menu.ts:69-108](repo://lib/browser/api/menu.ts#L69-L108)
