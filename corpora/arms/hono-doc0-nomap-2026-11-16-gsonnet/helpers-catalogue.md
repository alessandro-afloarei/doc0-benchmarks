---
title: "Built-in Helpers Catalogue"
---
## Overview

Helpers are plain functions, not middleware: you call them from a handler (usually passing the `Context`) and use the result. Each lives in `src/helper/<name>` and is imported from `hono/<name>`. This page lists the small ones; streaming, SSG, WebSocket and connection info have their own pages ([[Streaming Helpers]], [[Static Site Generation]], [[WebSocket Support]], [[Platform Adapters and Connection Info]]).

Sources: [src/helper/cookie/index.ts:27-48](repo://src/helper/cookie/index.ts#L27-L48), [src/helper/accepts/accepts.ts:40-49](repo://src/helper/accepts/accepts.ts#L40-L49)

| Helper | Use it to |
| --- | --- |
| `cookie` | Read, set and delete cookies, including signed and prefixed ones |
| `accepts` | Pick a value from an `Accept-*` header |
| `html` | Build escaped HTML with a tagged template |
| `css` | Generate scoped class names and a `<style>` element for JSX |
| `factory` | Create apps, middleware and handlers with shared types |
| `route` | Ask which route is handling the current request |
| `proxy` | Forward a request to another server and return its response |
| `testing` | Get a typed client for an app in a test |
| `dev` | Print the route table and find the active router's name |

Sources: [src/helper/cookie/index.ts:99-145](repo://src/helper/cookie/index.ts#L99-L145), [src/helper/html/index.ts:11-57](repo://src/helper/html/index.ts#L11-L57), [src/helper/css/index.ts:225-262](repo://src/helper/css/index.ts#L225-L262), [src/helper/factory/index.ts:332-375](repo://src/helper/factory/index.ts#L332-L375), [src/helper/route/index.ts:32-141](repo://src/helper/route/index.ts#L32-L141), [src/helper/proxy/index.ts:160-190](repo://src/helper/proxy/index.ts#L160-L190), [src/helper/testing/index.ts:16-27](repo://src/helper/testing/index.ts#L16-L27), [src/helper/dev/index.ts:27-79](repo://src/helper/dev/index.ts#L27-L79)

## Request and response data

### cookie

`getCookie(c, key?, prefix?)` reads the `Cookie` header: with a key it returns that value (or `undefined`), without a key it returns every cookie as an object. A `prefix` of `secure` or `host` adds `__Secure-` or `__Host-` to the key. `getSignedCookie(c, secret, key?, prefix?)` does the same but verifies the signature and returns `false` for a bad one.

Sources: [src/helper/cookie/index.ts:10-76](repo://src/helper/cookie/index.ts#L10-L76)

`setCookie(c, name, value, options)` appends a `Set-Cookie` header with `c.header(..., { append: true })`, so several cookies can be set on one response; `path` defaults to `/`. With `prefix: 'secure'` the name is prefixed and `secure` is forced on; with `prefix: 'host'` it also forces `path: '/'` and removes `domain`. `setSignedCookie` signs the value with a secret first, `generateCookie` and `generateSignedCookie` return the header string instead of setting it, and `deleteCookie` sets the cookie with `maxAge: 0` and returns the value it found.

Sources: [src/helper/cookie/index.ts:78-145](repo://src/helper/cookie/index.ts#L78-L145)

### accepts

`accepts(c, { header, supports, default, match })` parses the named `Accept-*` header with `parseAccept` and returns the best supported value. The default matcher sorts entries by quality and returns the first one in `supports`, falling back to `default`, which is also returned when the header is absent. A custom `match` function replaces the matcher.

Sources: [src/helper/accepts/accepts.ts:1-49](repo://src/helper/accepts/accepts.ts#L1-L49)

### html

The `html` tagged template returns an `HtmlEscapedString`: string values are escaped, numbers inserted, nullish and boolean values dropped, arrays flattened, and values already marked escaped (including `raw(...)` and JSX) inserted as they are. A promise or a string with late callbacks makes the result a promise. `raw` is re-exported to mark trusted text. It is the same escaping used by JSX; see [[JSX Server Rendering]].

Sources: [src/helper/html/index.ts:9-57](repo://src/helper/html/index.ts#L9-L57)

## Styling

### css

`css` is a tagged template that returns a class name backed by generated rules. Class names are hashed (`css-<number>`) from the content. When the result is rendered in a JSX tree, a callback adds the rule to the page: it replaces the content of the `<style id="hono-css">` element if one was rendered earlier, otherwise it prepends a small script that appends the rules to that element. `Style` renders that element, with an optional nonce. `cx` combines class names, `keyframes` produces animation names and `viewTransition` produces view-transition class names. `createCssContext({ id, classNameSlug, onInvalidSlug })` makes a separate instance with its own style element id; the module exports one default instance. External class names passed through `cx` are escaped, and ones containing `<`, `{` or `}` are rejected from use as selectors.

Sources: [src/helper/css/index.ts:72-166](repo://src/helper/css/index.ts#L72-L166), [src/helper/css/index.ts:169-215](repo://src/helper/css/index.ts#L169-L215), [src/helper/css/index.ts:225-262](repo://src/helper/css/index.ts#L225-L262), [src/helper/css/common.ts:1-60](repo://src/helper/css/common.ts#L1-L60)

The same API exists in the DOM runtime, wrapping the shared builders in `common.ts`; see [[JSX DOM Rendering and Hooks]].

Sources: [src/jsx/dom/css.ts:180-263](repo://src/jsx/dom/css.ts#L180-L263)

## App structure

### factory

`createFactory({ initApp, defaultAppOptions })` returns a `Factory` with three members. `createApp(options)` builds a `Hono` using the defaults (the given options are spread over them) and then calls `initApp(app)`, so every app from the factory starts configured the same way. `createMiddleware(fn)` and `createHandlers(...handlers)` return their arguments unchanged: they exist so that TypeScript can infer the environment, path and input types of handlers written outside the chain that uses them, with `createHandlers` typed for up to ten handlers and dropping `undefined` entries. `createMiddleware` is also exported on its own.

Sources: [src/helper/factory/index.ts:18-60](repo://src/helper/factory/index.ts#L18-L60), [src/helper/factory/index.ts:332-375](repo://src/helper/factory/index.ts#L332-L375)

### route

`matchedRoutes(c)` reads the match result stored on the request and returns every `RouterRoute` that matched. `routePath(c, index?)` and `baseRoutePath(c, index?)` return the `path` and `basePath` of the route at `index`, defaulting to the one currently executing (`routeIndex`; see [[Request Parsing and Validation]]); both return an empty string when there is none. `basePath(c, index?)` goes further when the base path of a route contains parameters: it measures the matched length in the real request path and returns the actual prefix, caching the result per context and index.

Sources: [src/helper/route/index.ts:32-141](repo://src/helper/route/index.ts#L32-L141)

### dev

`inspectRoutes(app)` lists `app.routes` with path, method, handler name (or `[handler]` / `[middleware]`) and an `isMiddleware` flag, using the same unwrapping of composed handlers as SSG. `showRoutes(app, { verbose, colorize })` prints method and path (middleware only with `verbose`, handler names below each route), with the method coloured green when colour is enabled. `getRouterName(app)` calls `app.router.match('GET', '/')` first, which forces a `SmartRouter` to choose, then returns the active name, such as `SmartRouter + RegExpRouter`. See [[Routers and Router Selection]].

Sources: [src/helper/dev/index.ts:11-79](repo://src/helper/dev/index.ts#L11-L79)

## Networking and testing

### proxy

`proxy(input, init)` is a `fetch` wrapper for reverse proxying. Pass a `raw` request (or a `Request` directly as the second argument) and its method, body, signal and headers are copied, with hop-by-hop headers removed (`connection`, `keep-alive`, `transfer-encoding`, `upgrade` and others). With `strictConnectionProcessing` it also removes the headers named in `Connection`, answering 400 with an `HTTPException` when that list contains invalid tokens. Header values of `null` or `undefined` in `init.headers` delete the header. The request's `accept-encoding` is removed so the upstream response is not compressed. In the response the hop-by-hop headers are removed, and a `content-encoding` removes `content-length` too. `customFetch` replaces the global `fetch`.

Sources: [src/helper/proxy/index.ts:10-113](repo://src/helper/proxy/index.ts#L10-L113), [src/helper/proxy/index.ts:160-190](repo://src/helper/proxy/index.ts#L160-L190)

### testing

`testClient(app, env, executionCtx, options)` returns an `hc` client for `http://localhost` whose `fetch` is `app.request(input, init, env, executionCtx)`, so the typed client from [[RPC Client (hc)]] calls the app in memory with no server.

Sources: [src/helper/testing/index.ts:13-27](repo://src/helper/testing/index.ts#L13-L27)
