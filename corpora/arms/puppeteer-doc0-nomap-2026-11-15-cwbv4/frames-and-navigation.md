---
title: "Frames and Navigation"
---
## Overview

A `Frame` is one document in a page: the top document or an `<iframe>`/`<frame>` inside it. Frames nest, and script run in one frame does not affect the others. The document-level API (navigation, queries, evaluation, simple actions, content) lives on `Frame`, and `Page` forwards to its main frame ([[Pages]]). `Frame` is abstract. This page covers the shared contract and the parts implemented once for both protocols; [[CDP Pages and Frame Management]] covers how CDP builds the frame tree and decides when a navigation is finished.

Sources: [packages/puppeteer-core/src/api/Frame.ts:216-310](repo://packages/puppeteer-core/src/api/Frame.ts#L216-L310)

## The frame tree

### Walking the tree

`parentFrame()` and `childFrames()` walk the tree, and `page.frames()` lists every frame. The page emits `frameattached`, `framenavigated` and `framedetached` as the tree changes. `name()` is the frame's `name` attribute and `url()` its current URL. The repository's own example dumps the tree recursively:

Sources: [packages/puppeteer-core/src/api/Frame.ts:216-284](repo://packages/puppeteer-core/src/api/Frame.ts#L216-L284), [packages/puppeteer-core/src/api/Frame.ts:860-877](repo://packages/puppeteer-core/src/api/Frame.ts#L860-L877)

```ts
function dumpFrameTree(frame, indent) {
  console.log(indent + frame.url());
  for (const child of frame.childFrames()) {
    dumpFrameTree(child, indent + '  ');
  }
}
```

Sources: [packages/puppeteer-core/src/api/Frame.ts:216-284](repo://packages/puppeteer-core/src/api/Frame.ts#L216-L284), [packages/puppeteer-core/src/api/Frame.ts:860-877](repo://packages/puppeteer-core/src/api/Frame.ts#L860-L877)

`frameElement()` goes the other way, from a child frame to the `<iframe>` element that hosts it. The shared implementation, in the parent's isolated realm, lists every `iframe` and `frame` element, asks each for its `contentFrame()` until one matches this frame's id, and adopts that handle into the parent's main realm. `CdpFrame` overrides it and asks the parent's session directly with `DOM.getFrameOwner`. A main frame returns `null`.

Sources: [packages/puppeteer-core/src/api/Frame.ts:431-449](repo://packages/puppeteer-core/src/api/Frame.ts#L431-L449), [packages/puppeteer-core/src/cdp/Frame.ts:428-439](repo://packages/puppeteer-core/src/cdp/Frame.ts#L428-L439)

### Detached frames

When an iframe is removed, its `Frame` becomes detached: `detached` (also exposed as `isDetached()` and `disposed`) turns true. The document-level methods carry the `@throwIfDetached` decorator, so calling one on a detached frame throws `Attempted to use detached Frame '<id>'` instead of sending commands to a context that no longer exists.

Sources: [packages/puppeteer-core/src/api/Frame.ts:212-214](repo://packages/puppeteer-core/src/api/Frame.ts#L212-L214), [packages/puppeteer-core/src/api/Frame.ts:882-898](repo://packages/puppeteer-core/src/api/Frame.ts#L882-L898), [packages/puppeteer-core/src/util/decorators.ts:53-66](repo://packages/puppeteer-core/src/util/decorators.ts#L53-L66)

## Realms: main and isolated

Each frame has two JavaScript realms. `mainRealm()` is the page's own world, where page scripts run and where user `evaluate` calls go. `isolatedRealm()` is a separate world Puppeteer creates for its internal code and bindings; it sees the same DOM as the page. `title()` and the tag-injecting helpers below run in the isolated realm; results that the user receives are moved to the main realm with `transferHandle` or `adoptHandle`.

Sources: [packages/puppeteer-core/src/api/Frame.ts:398-403](repo://packages/puppeteer-core/src/api/Frame.ts#L398-L403), [packages/puppeteer-core/src/api/Frame.ts:1174-1179](repo://packages/puppeteer-core/src/api/Frame.ts#L1174-L1179), [packages/puppeteer-core/src/cdp/IsolatedWorlds.ts:9-20](repo://packages/puppeteer-core/src/cdp/IsolatedWorlds.ts#L9-L20)

`Realm` is itself an abstract class shared by both backends. Besides `evaluate`, `evaluateHandle`, `adoptHandle` and `transferHandle`, it implements `waitForFunction` once by creating a `WaitTask`, and owns a `TaskManager` so that disposing the realm (when its frame detaches) rejects every pending wait with `waitForFunction failed: frame got detached.` [[Waiting for Conditions]] follows the wait itself.

Sources: [packages/puppeteer-core/src/api/Realm.ts:23-108](repo://packages/puppeteer-core/src/api/Realm.ts#L23-L108)

## Navigation

### goto

`frame.goto(url, options)` navigates and resolves with the main resource's `HTTPResponse` (the last one after redirects). It resolves with `null` for `about:blank` and for same-document navigations such as a hash change. It throws on an SSL error, an invalid URL, an unreachable server, a failed main resource, or a timeout. An HTTP error status such as 404 is not an exception: check `response.status()`.

Sources: [packages/puppeteer-core/src/api/Frame.ts:316-357](repo://packages/puppeteer-core/src/api/Frame.ts#L316-L357)

`GoToOptions` adds `referer` and `referrerPolicy` to the shared `WaitForOptions`; both override any value set through `setExtraHTTPHeaders`.

Sources: [packages/puppeteer-core/src/api/Frame.ts:78-89](repo://packages/puppeteer-core/src/api/Frame.ts#L78-L89)

### When a navigation counts as finished

`WaitForOptions.waitUntil` names one or more lifecycle events; with several, all must fire. The default is `load`.

Sources: [packages/puppeteer-core/src/api/Frame.ts:47-73](repo://packages/puppeteer-core/src/api/Frame.ts#L47-L73), [packages/puppeteer-core/src/cdp/LifecycleWatcher.ts:26-44](repo://packages/puppeteer-core/src/cdp/LifecycleWatcher.ts#L26-L44)

| `waitUntil` | Finished when |
| --- | --- |
| `load` | The `load` event fired |
| `domcontentloaded` | The `DOMContentLoaded` event fired |
| `networkidle0` | No network connections for at least 500 ms |
| `networkidle2` | At most 2 network connections for at least 500 ms |

Sources: [packages/puppeteer-core/src/api/Frame.ts:47-73](repo://packages/puppeteer-core/src/api/Frame.ts#L47-L73), [packages/puppeteer-core/src/cdp/LifecycleWatcher.ts:26-44](repo://packages/puppeteer-core/src/cdp/LifecycleWatcher.ts#L26-L44)

The `timeout` option defaults to the page's navigation timeout (30 seconds unless changed with `setDefaultNavigationTimeout` or `setDefaultTimeout`), and `0` disables it. A `signal` cancels the wait.

Sources: [packages/puppeteer-core/src/api/Frame.ts:47-73](repo://packages/puppeteer-core/src/api/Frame.ts#L47-L73), [packages/puppeteer-core/src/common/TimeoutSettings.ts:29-37](repo://packages/puppeteer-core/src/common/TimeoutSettings.ts#L29-L37)

### waitForNavigation

`waitForNavigation(options)` waits for a navigation that something else starts, such as a click. History API changes (`pushState`) count as navigations. Start the wait before the action, so a fast navigation is not missed:

Sources: [packages/puppeteer-core/src/api/Frame.ts:358-383](repo://packages/puppeteer-core/src/api/Frame.ts#L358-L383)

```ts
const [response] = await Promise.all([
  // The navigation promise resolves after navigation has finished
  frame.waitForNavigation(),
  // Clicking the link will indirectly cause a navigation
  frame.click('a.my-link'),
]);
```

Sources: [packages/puppeteer-core/src/api/Frame.ts:358-383](repo://packages/puppeteer-core/src/api/Frame.ts#L358-L383)

## Reading and writing content

### Serialising and replacing the document

`content()` serialises the whole document, doctype included: it walks `document.childNodes`, takes `outerHTML` for the root element and `XMLSerializer` output for every other node.

Sources: [packages/puppeteer-core/src/api/Frame.ts:804-821](repo://packages/puppeteer-core/src/api/Frame.ts#L804-L821)

`setContent(html, options)` replaces the document. The shared helper `setFrameContent` runs `document.open()`, `document.write(html)` and `document.close()` in the main realm. On CDP, `setContent` then waits for the `waitUntil` events with a `LifecycleWatcher`, relying on `document.open()` to reset the frame's lifecycle state, so `load` means the new content's load.

Sources: [packages/puppeteer-core/src/api/Frame.ts:830-841](repo://packages/puppeteer-core/src/api/Frame.ts#L830-L841), [packages/puppeteer-core/src/cdp/Frame.ts:276-306](repo://packages/puppeteer-core/src/cdp/Frame.ts#L276-L306)

### Injecting scripts and styles

`addScriptTag` and `addStyleTag` take exactly one of `url`, `path` or `content` and throw otherwise. A `path` is read from disk through `environment.value.fs` and gets a `sourceURL` comment, so the injected code shows up under that file name in DevTools. The element is created in the isolated realm and appended to `document.head`, and the call resolves with a handle in the main realm.

Sources: [packages/puppeteer-core/src/api/Frame.ts:907-962](repo://packages/puppeteer-core/src/api/Frame.ts#L907-L962), [packages/puppeteer-core/src/api/Frame.ts:987-1043](repo://packages/puppeteer-core/src/api/Frame.ts#L987-L1043)

The two differ in when they resolve. A script with `url` resolves on its `load` event; an inline script resolves as soon as it is appended. A style tag always waits for `load`. Load errors reject with the event's message, or `Could not load script` / `Could not load style`. `addScriptTag` also accepts `type` (default `text/javascript`) and `id`.

Sources: [packages/puppeteer-core/src/api/Frame.ts:924-961](repo://packages/puppeteer-core/src/api/Frame.ts#L924-L961), [packages/puppeteer-core/src/api/Frame.ts:1005-1042](repo://packages/puppeteer-core/src/api/Frame.ts#L1005-L1042), [packages/puppeteer-core/src/api/Frame.ts:123-148](repo://packages/puppeteer-core/src/api/Frame.ts#L123-L148)

## Queries and actions in a frame

### Queries go through the document handle

`$`, `$$`, `$eval` and `$$eval` all start from a cached `ElementHandle<Document>` that the frame creates on first use by evaluating `document` in the main realm. They then call the same method on that handle, so frame queries and element queries share one implementation ([[Element Handles]], [[Selectors and Query Handlers]]). The cache is cleared with `clearDocumentHandle()` when the main realm's execution context is disposed, for example by a navigation.

Sources: [packages/puppeteer-core/src/api/Frame.ts:405-426](repo://packages/puppeteer-core/src/api/Frame.ts#L405-L426), [packages/puppeteer-core/src/cdp/IsolatedWorld.ts:102-107](repo://packages/puppeteer-core/src/cdp/IsolatedWorld.ts#L102-L107), [packages/puppeteer-core/src/api/Frame.ts:558-597](repo://packages/puppeteer-core/src/api/Frame.ts#L558-L597), [packages/puppeteer-core/src/api/Frame.ts:633-703](repo://packages/puppeteer-core/src/api/Frame.ts#L633-L703)

### Selector-based actions

`click`, `focus`, `hover`, `select`, `tap` and `type` each run `this.$(selector)` once, assert that an element was found (`No element found for selector: …`), call the matching `ElementHandle` method, and dispose the handle through `using`. They do not wait or retry; use `waitForSelector` first, or a locator, when the element may appear later.

Sources: [packages/puppeteer-core/src/api/Frame.ts:1063-1169](repo://packages/puppeteer-core/src/api/Frame.ts#L1063-L1169)

### Waiting and locators

`waitForSelector` resolves the selector's query handler and polling mode with `getQueryHandlerAndSelector` and calls that handler's `waitFor`. `waitForFunction` delegates to the main realm. `locator()` creates a `NodeLocator` or `FunctionLocator` scoped to the frame ([[Locators]]).

Sources: [packages/puppeteer-core/src/api/Frame.ts:740-800](repo://packages/puppeteer-core/src/api/Frame.ts#L740-L800), [packages/puppeteer-core/src/api/Frame.ts:513-535](repo://packages/puppeteer-core/src/api/Frame.ts#L513-L535)

## Internal frame events

Besides the page-level events, each `Frame` emits internal events keyed by symbols: `FrameNavigated` (with the navigation type), `FrameNavigatedWithinDocument`, `LifecycleEvent`, `FrameSwapped` (CDP detached the frame with reason `swap`, as when an iframe moves to another process), `FrameSwappedByActivation` (the main frame was replaced by an activated page, such as a prerendered one) and `FrameDetached`. They are not public API; the lifecycle watcher and the frame manager listen to them.

Sources: [packages/puppeteer-core/src/api/Frame.ts:174-207](repo://packages/puppeteer-core/src/api/Frame.ts#L174-L207), [packages/puppeteer-core/src/cdp/FrameManager.ts:136-158](repo://packages/puppeteer-core/src/cdp/FrameManager.ts#L136-L158), [packages/puppeteer-core/src/cdp/FrameManager.ts:515-532](repo://packages/puppeteer-core/src/cdp/FrameManager.ts#L515-L532)
