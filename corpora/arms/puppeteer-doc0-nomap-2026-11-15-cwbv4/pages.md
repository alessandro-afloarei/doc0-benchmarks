---
title: "Pages"
---
## Overview

A `Page` is one tab (or popup) and the object most scripts spend their time with. It owns a tree of frames, the input devices, the page-level settings (viewport, user agent, timeouts, interception) and a stream of events. `Page` is an abstract class: `CdpPage` and `BidiPage` implement its abstract methods, while the methods shared by both backends are written once in `api/Page.ts`. Many of those shared methods do nothing more than forward to the main frame. This page explains how the class is organised; frames, network, emulation and capture each have their own page.

Sources: [packages/puppeteer-core/src/api/Page.ts:685-700](repo://packages/puppeteer-core/src/api/Page.ts#L685-L700), [packages/puppeteer-core/src/api/Page.ts:871-933](repo://packages/puppeteer-core/src/api/Page.ts#L871-L933)

## How the API is organised

### Methods that delegate to the main frame

Everything that concerns the document itself lives on `Frame`, and `Page` forwards to `this.mainFrame()`. That covers `goto`, `waitForNavigation`, `setContent`, `content`, `url`, `title`, the query methods (`$`, `$$`, `$eval`, `$$eval`), `evaluate` and `evaluateHandle`, `addScriptTag` and `addStyleTag`, the selector-based actions (`click`, `focus`, `hover`, `select`, `tap`, `type`), and the waits `waitForSelector` and `waitForFunction`. Their behaviour is documented once in [[Frames and Navigation]], [[JavaScript Evaluation and Handles]] and [[Waiting for Conditions]].

Sources: [packages/puppeteer-core/src/api/Page.ts:1707-1777](repo://packages/puppeteer-core/src/api/Page.ts#L1707-L1777), [packages/puppeteer-core/src/api/Page.ts:2787-2855](repo://packages/puppeteer-core/src/api/Page.ts#L2787-L2855), [packages/puppeteer-core/src/api/Page.ts:2893-2967](repo://packages/puppeteer-core/src/api/Page.ts#L2893-L2967), [packages/puppeteer-core/src/api/Page.ts:3033-3107](repo://packages/puppeteer-core/src/api/Page.ts#L3033-L3107)

```ts
async goto(url: string, options?: GoToOptions): Promise<HTTPResponse | null> {
  return await this.mainFrame().goto(url, options);
}
```

Sources: [packages/puppeteer-core/src/api/Page.ts:1731-1733](repo://packages/puppeteer-core/src/api/Page.ts#L1731-L1733)

### Methods each backend implements

The abstract methods are those that need protocol calls specific to the page rather than the document: `reload`, `goBack`, `goForward`, `bringToFront`, `close`, the emulation family (`setViewport`, `emulateMediaType`, `emulateTimezone` and others, see [[Emulation]]), network settings (`setRequestInterception`, `setExtraHTTPHeaders`, `authenticate`, `setOfflineMode`, `setCacheEnabled`, see [[Network Requests and Interception]]), `exposeFunction`, `evaluateOnNewDocument`, `pdf` and `createPDFStream`, `metrics`, `setGeolocation`, `waitForFileChooser` and `waitForDevicePrompt`.

Sources: [packages/puppeteer-core/src/api/Page.ts:1602-1698](repo://packages/puppeteer-core/src/api/Page.ts#L1602-L1698), [packages/puppeteer-core/src/api/Page.ts:1987-2088](repo://packages/puppeteer-core/src/api/Page.ts#L1987-L2088), [packages/puppeteer-core/src/api/Page.ts:2151-2257](repo://packages/puppeteer-core/src/api/Page.ts#L2151-L2257)

### Accessors

| Accessor | Returns |
| --- | --- |
| `mainFrame()`, `frames()` | The top frame and every attached frame |
| `workers()` | Dedicated workers spawned by the page |
| `keyboard`, `mouse`, `touchscreen` | Input devices ([[Keyboard, Mouse and Touch]]) |
| `coverage`, `tracing` | Profiling helpers ([[Code Coverage and Tracing]]) |
| `accessibility` | The main frame's accessibility helper ([[Accessibility Snapshots]]) |
| `target()`, `browser()`, `browserContext()` | Where the page lives ([[Browsers, Browser Contexts and Targets]]) |
| `createCDPSession()` | A raw CDP session to the page target |

Sources: [packages/puppeteer-core/src/api/Page.ts:871-933](repo://packages/puppeteer-core/src/api/Page.ts#L871-L933), [packages/puppeteer-core/src/api/Page.ts:2743-2743](repo://packages/puppeteer-core/src/api/Page.ts#L2743-L2743)

## Page events

### Event list

`Page` extends the typed `EventEmitter`, and `PageEvents` maps each event name to its payload:

Sources: [packages/puppeteer-core/src/api/Page.ts:439-512](repo://packages/puppeteer-core/src/api/Page.ts#L439-L512), [packages/puppeteer-core/src/api/Page.ts:534-614](repo://packages/puppeteer-core/src/api/Page.ts#L534-L614)

| Event | Payload | When |
| --- | --- | --- |
| `close` | none | The page closed |
| `console` | `ConsoleMessage` | Page script called a console method |
| `dialog` | `Dialog` | `alert`, `confirm`, `prompt` or `beforeunload` opened ([[Dialogs, File Choosers and Device Prompts]]) |
| `domcontentloaded`, `load` | none | The main document fired the event |
| `error` | `Error` | The page crashed |
| `pageerror` | `Error` | An uncaught exception in the page |
| `frameattached`, `framedetached`, `framenavigated` | `Frame` | Frame tree changes |
| `metrics` | `{title, metrics}` | Page called `console.timeStamp` |
| `popup` | `Page` | The page opened a new tab or window |
| `request`, `response`, `requestfinished`, `requestfailed`, `requestservedfromcache` | `HTTPRequest` or `HTTPResponse` | Network activity |
| `workercreated`, `workerdestroyed` | `WebWorker` | Dedicated workers |

Sources: [packages/puppeteer-core/src/api/Page.ts:439-512](repo://packages/puppeteer-core/src/api/Page.ts#L439-L512), [packages/puppeteer-core/src/api/Page.ts:534-614](repo://packages/puppeteer-core/src/api/Page.ts#L534-L614)

### Console messages

A `ConsoleMessage` carries the console method as `type()`, the formatted `text()`, the arguments as `JSHandle`s in `args()`, and the stack trace. `location()` is the top stack frame, or just the frame's URL when there is no stack.

Sources: [packages/puppeteer-core/src/common/ConsoleMessage.ts:59-120](repo://packages/puppeteer-core/src/common/ConsoleMessage.ts#L59-L120)

### Request listeners run in order

`Page` overrides `on` and `off` for the `request` event. Each handler is wrapped so that it runs through `request.enqueueInterceptAction(...)` instead of directly. With interception enabled, the handlers of one request then run one after another, even when they are `async`, which lets several handlers vote on how to resolve it ([[Network Requests and Interception]]). A `WeakMap` remembers the wrapper so that `off` with the original function still removes it.

Sources: [packages/puppeteer-core/src/api/Page.ts:767-810](repo://packages/puppeteer-core/src/api/Page.ts#L767-L810)

## Waiting for page activity

### Requests and responses

`waitForRequest` and `waitForResponse` take a URL string or a predicate (which may be async). They filter the `request` or `response` event stream and resolve with the first match. Each races against the timeout, an optional `AbortSignal`, and the page's `close` event, which rejects with `TargetCloseError('Page closed!')`.

Sources: [packages/puppeteer-core/src/api/Page.ts:1802-1879](repo://packages/puppeteer-core/src/api/Page.ts#L1802-L1879)

### Network idle

The constructor keeps a running count of in-flight requests. Each `request` adds one, and the first `requestfinished`, `requestfailed` or `response` for that request id subtracts one. The count is published through a `ReplaySubject`, so a new subscriber sees the current value immediately.

Sources: [packages/puppeteer-core/src/api/Page.ts:697-736](repo://packages/puppeteer-core/src/api/Page.ts#L697-L736)

`waitForNetworkIdle({idleTime, concurrency})` maps that count to "more than `concurrency` requests in flight". While it is true nothing happens; when it becomes false, a timer of `idleTime` (500 ms by default) starts, and any new request cancels it through `switchMap`. The promise resolves when a timer completes, and it races the timeout, the abort signal and page close like the other waits.

Sources: [packages/puppeteer-core/src/api/Page.ts:1890-1929](repo://packages/puppeteer-core/src/api/Page.ts#L1890-L1929), [packages/puppeteer-core/src/api/Page.ts:145-161](repo://packages/puppeteer-core/src/api/Page.ts#L145-L161), [packages/puppeteer-core/src/common/util.ts:319-319](repo://packages/puppeteer-core/src/common/util.ts#L319-L319)

### Frames

`waitForFrame(urlOrPredicate)` checks the existing frames and every later `frameattached` and `framenavigated` event, so it finds a frame that appears later and a frame that navigates to the expected URL after it attached.

Sources: [packages/puppeteer-core/src/api/Page.ts:1947-1978](repo://packages/puppeteer-core/src/api/Page.ts#L1947-L1978)

## Timeouts

Every page has a `TimeoutSettings` with two values. `setDefaultTimeout` applies to waits and actions; `setDefaultNavigationTimeout` applies to navigations. The navigation timeout falls back to the general timeout, and both fall back to 30 seconds. An explicit `timeout` option on a call always wins, and `0` disables the timeout for that call.

Sources: [packages/puppeteer-core/src/common/TimeoutSettings.ts:7-45](repo://packages/puppeteer-core/src/common/TimeoutSettings.ts#L7-L45), [packages/puppeteer-core/src/api/Page.ts:1046-1061](repo://packages/puppeteer-core/src/api/Page.ts#L1046-L1061), [packages/puppeteer-core/src/common/util.ts:288-296](repo://packages/puppeteer-core/src/common/util.ts#L288-L296)

## Locators

`page.locator(input)` returns a `NodeLocator` for a selector string or a `FunctionLocator` for a function; `page.locatorRace([...])` races several locators. [[Locators]] covers how they retry.

Sources: [packages/puppeteer-core/src/api/Page.ts:1083-1128](repo://packages/puppeteer-core/src/api/Page.ts#L1083-L1128)

## Other page-level operations

| Method | What it does |
| --- | --- |
| `emulate(device)` | Sets a device's user agent and viewport together ([[Emulation]]) |
| `metrics()` | Returns counters such as `Nodes`, `JSHeapUsedSize`, `LayoutCount` and `ScriptDuration` |
| `exposeFunction(name, fn)` | Installs `window[name]`, which calls `fn` in Node and returns its result ([[JavaScript Evaluation and Handles]]) |
| `evaluateOnNewDocument(fn, ...args)` | Runs `fn` in every new document before page scripts; returns an identifier for `removeScriptToEvaluateOnNewDocument` |
| `screenshot`, `pdf`, `screencast` | Captures ([[Screenshots, PDFs and Screen Recording]]) |
| `close({runBeforeUnload})` | Closes the page, optionally running `beforeunload` handlers first |

Sources: [packages/puppeteer-core/src/api/Page.ts:2032-2037](repo://packages/puppeteer-core/src/api/Page.ts#L2032-L2037), [packages/puppeteer-core/src/api/Page.ts:3162-3176](repo://packages/puppeteer-core/src/api/Page.ts#L3162-L3176), [packages/puppeteer-core/src/api/Page.ts:2352-2368](repo://packages/puppeteer-core/src/api/Page.ts#L2352-L2368), [packages/puppeteer-core/src/api/Page.ts:2732-2738](repo://packages/puppeteer-core/src/api/Page.ts#L2732-L2738)

A page is disposable: `await using page = await browser.newPage()` closes it at the end of the block.

Sources: [packages/puppeteer-core/src/api/Page.ts:3149-3156](repo://packages/puppeteer-core/src/api/Page.ts#L3149-L3156)
