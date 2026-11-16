---
title: "Helpers Catalogue"
---
## Overview

The folders under `src/helper` hold functions you call from handlers and middleware rather than middleware themselves. Each ships under its own subpath (`hono/cookie`, `hono/proxy`, and so on). This page says what each does and when to reach for it. Streaming has its own page in [[Streaming and Server-Sent Events]] and static generation in [[Static Site Generation]].

Sources: [src/helper/cookie/index.ts:27-48](repo://src/helper/cookie/index.ts#L27-L48), [src/helper/proxy/index.ts:160-190](repo://src/helper/proxy/index.ts#L160-L190)

| Helper | Use it to |
| --- | --- |
| `hono/cookie` | Read, set, sign and delete cookies |
| `hono/factory` | Build apps, middleware and handler lists with shared types |
| `hono/proxy` | Forward a request to another server |
| `hono/html` | Write HTML with escaped template literals |
| `hono/css` | Generate scoped CSS classes for JSX |
| `hono/accepts` | Content negotiation from `Accept*` headers |
| `hono/adapter` | Detect the runtime and read environment variables |
| `hono/conninfo` | Types for the client's connection information |
| `hono/route` | Inspect matched routes from inside a handler |
| `hono/dev` | List the registered routes |
| `hono/testing` | Typed client bound to an app |
| `hono/websocket` | Shared WebSocket types and upgrade helper |

Sources: [src/helper/factory/index.ts:332-375](repo://src/helper/factory/index.ts#L332-L375), [src/helper/accepts/accepts.ts:40-49](repo://src/helper/accepts/accepts.ts#L40-L49), [src/helper/adapter/index.ts:50-84](repo://src/helper/adapter/index.ts#L50-L84), [src/helper/dev/index.ts:27-79](repo://src/helper/dev/index.ts#L27-L79)

## Cookies

`getCookie(c, key?, prefix?)` parses the request's `Cookie` header and returns one value or an object of all cookies. `getSignedCookie(c, secret, key?, prefix?)` does the same for signed cookies and resolves to `false` when the signature does not verify (its type allows `string | undefined | false`). `setCookie` and `setSignedCookie` append a `Set-Cookie` header to the response through `c.header(..., { append: true })`, so several cookies can be set. `deleteCookie` sets the cookie to an empty value with `maxAge: 0` and returns the previous value.

Sources: [src/helper/cookie/index.ts:10-76](repo://src/helper/cookie/index.ts#L10-L76), [src/helper/cookie/index.ts:99-145](repo://src/helper/cookie/index.ts#L99-L145)

The `prefix` option accepts `secure` or `host`. For `secure` the name gets `__Secure-` and `secure: true` is forced; for `host` it gets `__Host-`, with `path: '/'`, `secure: true` and no domain, as the browser rules for those prefixes require. All other cookies default to `path: '/'`. `generateCookie` and `generateSignedCookie` return the header string without touching the context. The [[Authentication Middleware and JWT]] and [[Validation]] pages use `getCookie` and `getSignedCookie` as well.

Sources: [src/helper/cookie/index.ts:78-97](repo://src/helper/cookie/index.ts#L78-L97), [src/helper/cookie/index.ts:104-128](repo://src/helper/cookie/index.ts#L104-L128)

## Factory

`createFactory({ initApp, defaultAppOptions })` returns a `Factory` that shares one environment type across a project. `createApp(options)` builds a `Hono` using the default options (merged with the ones you pass) and runs `initApp` on it. `createMiddleware(fn)` is an identity function that only fixes the types, and the standalone `createMiddleware` does the same without a factory. `createHandlers(...handlers)` returns its arguments as a tuple (dropping `undefined`), with up to ten overloads that carry each handler's input and environment types forward, so handlers defined apart from `app.get(...)` keep their inferred types.

Sources: [src/helper/factory/index.ts:332-375](repo://src/helper/factory/index.ts#L332-L375), [src/helper/factory/index.ts:20-31](repo://src/helper/factory/index.ts#L20-L31)

## Proxy

`proxy(url, init)` is `fetch` with proxy-safe behaviour: you can pass a `raw` request (or a `Request` as the second argument) to forward its method, body, headers and abort signal. Hop-by-hop headers (`connection`, `keep-alive`, `transfer-encoding`, `upgrade` and others) are removed from the outgoing request and from the response, `Accept-Encoding` is dropped from the outgoing request, and when the response has a `Content-Encoding` both that header and `Content-Length` are removed. Header values of `undefined` delete the header. `customFetch` replaces the global `fetch`.

Sources: [src/helper/proxy/index.ts:10-19](repo://src/helper/proxy/index.ts#L10-L19), [src/helper/proxy/index.ts:50-113](repo://src/helper/proxy/index.ts#L50-L113), [src/helper/proxy/index.ts:160-190](repo://src/helper/proxy/index.ts#L160-L190)

By default the `Connection` header is ignored, which the option's comment says prevents hop-by-hop header injection. With `strictConnectionProcessing: true` the headers it names are deleted too, after each name is validated against the token syntax, and an invalid name throws a 400 `HTTPException`.

Sources: [src/helper/proxy/index.ts:21-22](repo://src/helper/proxy/index.ts#L21-L22), [src/helper/proxy/index.ts:32-43](repo://src/helper/proxy/index.ts#L32-L43), [src/helper/proxy/index.ts:60-78](repo://src/helper/proxy/index.ts#L60-L78)

## HTML and CSS

`html` is a tagged template. Strings are escaped, numbers added as is, booleans, `null` and `undefined` skipped, arrays flattened, and values already marked escaped (such as the result of `raw()` or another `html` call) inserted verbatim. Promises make the result a promise. It returns an `HtmlEscapedString` that `c.html` accepts; the same escaping machinery underlies [[JSX Server Rendering]].

Sources: [src/helper/html/index.ts:9-57](repo://src/helper/html/index.ts#L9-L57)

The `css` helper exports `css`, `cx`, `keyframes`, `viewTransition` and a `Style` component, all marked experimental. They are created by `createCssContext({ id, classNameSlug, onInvalidSlug })`, with a default context using the style element id `hono-css`. Class names are collected per render and appended to the `<style>` element, through a script when the element has already been streamed. `rawCssString` marks a value that should not be escaped.

Sources: [src/helper/css/index.ts:29-30](repo://src/helper/css/index.ts#L29-L30), [src/helper/css/index.ts:62-100](repo://src/helper/css/index.ts#L62-L100), [src/helper/css/index.ts:225-262](repo://src/helper/css/index.ts#L225-L262), [src/helper/css/common.ts:2-4](repo://src/helper/css/common.ts#L2-L4)

## Content negotiation

`accepts(c, { header, supports, default, match })` reads the named `Accept*` header, parses it with `parseAccept`, and returns the supported value with the highest quality, or `default` when the header is absent or nothing matches. Pass your own `match` function to change the rule.

Sources: [src/helper/accepts/accepts.ts:11-25](repo://src/helper/accepts/accepts.ts#L11-L25), [src/helper/accepts/accepts.ts:40-49](repo://src/helper/accepts/accepts.ts#L40-L49)

## Runtime and connection information

`getRuntimeKey()` returns `node`, `deno`, `bun`, `workerd`, `fastly`, `edge-light` or `other`. It checks `navigator.userAgent` against known prefixes first, then the Edge Runtime and Fastly globals, then `process.release.name`. `env(c, runtime?)` returns environment variables in the way the runtime exposes them: `process.env` for Bun, Node and edge-light, `Deno.env.toObject()` for Deno, `c.env` for workerd, and an empty object for Fastly and others.

Sources: [src/helper/adapter/index.ts:8-41](repo://src/helper/adapter/index.ts#L8-L41), [src/helper/adapter/index.ts:43-90](repo://src/helper/adapter/index.ts#L43-L90)

`hono/conninfo` exports only types: `GetConnInfo` is `(c) => ConnInfo`, and `ConnInfo.remote` carries `address`, `addressType`, `port` and `transport`. Each runtime adapter provides the function (see [[Runtime Adapters]]); the `ipRestriction` middleware from [[Built-in Middleware Catalogue]] takes it as its address source.

Sources: [src/helper/conninfo/types.ts:3-45](repo://src/helper/conninfo/types.ts#L3-L45), [src/helper/conninfo/index.ts:5-6](repo://src/helper/conninfo/index.ts#L5-L6)

## Inspecting routes

`matchedRoutes(c)` returns the `RouterRoute` of every handler matched for the request, and `routePath(c)`, `baseRoutePath(c)` and `basePath(c)` return the registered path, the registered base path, and the base path as it appeared in the actual request, for the current handler (or the index you give). They replace the deprecated `c.req.matchedRoutes` and `c.req.routePath` described in [[Request and Body Parsing]].

Sources: [src/helper/route/index.ts:32-34](repo://src/helper/route/index.ts#L32-L34), [src/helper/route/index.ts:58-59](repo://src/helper/route/index.ts#L58-L59), [src/helper/route/index.ts:82-141](repo://src/helper/route/index.ts#L82-L141)

`inspectRoutes(app)` maps `app.routes` to `{ path, method, name, isMiddleware }`, and `showRoutes(app, { verbose, colorize })` prints them, hiding middleware unless `verbose` is set. `getRouterName(app)` forces a match so a `SmartRouter` has chosen, then returns the router's name (see [[Router Interface and Selection]]).

Sources: [src/helper/dev/index.ts:23-79](repo://src/helper/dev/index.ts#L23-L79)

## Testing and WebSockets

`testClient(app, Env, executionCtx, options)` returns a typed client (see [[Typed RPC Client]]) whose `fetch` is `app.request` on `http://localhost`, so a test can call routes with full types and no server.

Sources: [src/helper/testing/index.ts:13-27](repo://src/helper/testing/index.ts#L13-L27)

`hono/websocket` defines the portable pieces: the `WSEvents` callbacks (`onOpen`, `onMessage`, `onClose`, `onError`), a `WSContext` wrapper with `send`, `close`, `readyState`, `url` and `protocol`, and `defineWebSocketHelper`, which builds an `upgradeWebSocket` function that works either as middleware (`upgradeWebSocket((c) => events)`) or called directly with a context, throwing `Failed to upgrade WebSocket` when the handler returns nothing. Runtime adapters implement the handler.

Sources: [src/helper/websocket/index.ts:14-19](repo://src/helper/websocket/index.ts#L14-L19), [src/helper/websocket/index.ts:70-91](repo://src/helper/websocket/index.ts#L70-L91), [src/helper/websocket/index.ts:111-140](repo://src/helper/websocket/index.ts#L111-L140)
