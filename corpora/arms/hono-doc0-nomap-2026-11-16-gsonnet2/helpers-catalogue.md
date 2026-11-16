---
title: "Helpers Catalogue"
---
## Overview

`src/helper` holds small utilities that are not middleware: they are functions you call inside handlers (or when building the app) and each is imported from its own entry point such as `hono/cookie` or `hono/streaming`. They work on a `Context` ([[Context and Responses]]) and keep to Web Standard objects. Three helpers have their own pages: `ssg` ([[Static Site Generation]]), and `adapter`, `conninfo` and `websocket` ([[Runtime Adapters]]).

Sources: [src/helper/cookie/index.ts:27-48](repo://src/helper/cookie/index.ts#L27-L48), [src/helper/streaming/stream.ts:7-45](repo://src/helper/streaming/stream.ts#L7-L45)

| Helper | For |
| --- | --- |
| `accepts` | Pick a supported value from an `Accept-*` header |
| `cookie` | Read, set, sign and delete cookies |
| `css` | Scoped CSS-in-JS for the JSX renderer |
| `dev` | Inspect and print registered routes |
| `factory` | Typed handler, middleware and app creators |
| `html` | Escaping `html` template tag |
| `proxy` | Forward a request to another server |
| `route` | Which routes matched the current request |
| `streaming` | Chunked, text and Server-Sent Events responses |
| `testing` | Typed client bound to an app |

Sources: [src/helper/accepts/accepts.ts:40-49](repo://src/helper/accepts/accepts.ts#L40-L49), [src/helper/dev/index.ts:27-79](repo://src/helper/dev/index.ts#L27-L79), [src/helper/testing/index.ts:16-27](repo://src/helper/testing/index.ts#L16-L27)

## Content negotiation: accepts

`accepts(c, { header, supports, default, match? })` reads the named `Accept-*` header, parses it with `parseAccept` and returns one of `supports`. The default matcher sorts the parsed entries by quality, descending, and returns the first whose type is supported, falling back to `default`. A missing header returns `default` immediately. Pass `match` to change the rule.

Sources: [src/helper/accepts/accepts.ts:5-49](repo://src/helper/accepts/accepts.ts#L5-L49)

## Cookies

`getCookie(c, key?, prefix?)` parses the request `Cookie` header: with a key it returns that cookie's value (or `undefined`), without a key it returns all cookies as an object. `setCookie(c, name, value, options)` appends a `Set-Cookie` header with `c.header(..., { append: true })`. The default path is `/`. The `prefix` option `'secure'` or `'host'` prepends `__Secure-` or `__Host-` and forces the attributes those prefixes require (`secure`, and for `host` also `path: '/'` and no `domain`). `deleteCookie` returns the old value and sets the cookie empty with `maxAge: 0`.

Sources: [src/helper/cookie/index.ts:27-48](repo://src/helper/cookie/index.ts#L27-L48), [src/helper/cookie/index.ts:78-102](repo://src/helper/cookie/index.ts#L78-L102), [src/helper/cookie/index.ts:141-145](repo://src/helper/cookie/index.ts#L141-L145)

`getSignedCookie`, `setSignedCookie` and `generateSignedCookie` do the same with a secret (a string or `BufferSource`) through `parseSigned` and `serializeSigned`; a cookie whose signature does not match is read as `false`. The `jwt` middleware uses these to take a token from a signed cookie ([[Authentication and Security Middleware]]).

Sources: [src/helper/cookie/index.ts:16-25](repo://src/helper/cookie/index.ts#L16-L25), [src/helper/cookie/index.ts:50-76](repo://src/helper/cookie/index.ts#L50-L76), [src/helper/cookie/index.ts:104-139](repo://src/helper/cookie/index.ts#L104-L139)

## Factory

`createFactory({ initApp, defaultAppOptions })` returns a `Factory` that shares one `Env` type across the pieces of a project. `factory.createApp(options)` builds a `Hono` using the default options (merged with explicit ones) and runs `initApp` on it. `factory.createMiddleware(fn)` returns `fn` unchanged and `factory.createHandlers(...)` returns the handlers as an array with `undefined` entries removed; these exist to give TypeScript the shared `Env` and to infer input and response types across several handlers ([[Validator and Typed Routes]]). The standalone `createMiddleware` does the same without a factory.

Sources: [src/helper/factory/index.ts:332-375](repo://src/helper/factory/index.ts#L332-L375)

## HTML templates

The `html` tag escapes interpolated values: strings go through `escapeToBuffer`, numbers are appended, `null`, `undefined` and booleans are dropped, arrays are flattened, and values that are already escaped (`raw` strings, JSX nodes) pass through untouched. A promise among the values makes the result a `Promise`. `raw` is re-exported to mark a trusted string. The same buffer mechanism is used by JSX rendering ([[JSX Server Rendering and Streaming]]).

Sources: [src/helper/html/index.ts:9-57](repo://src/helper/html/index.ts#L9-L57)

## CSS-in-JS

`hono/css` builds class names from tagged templates. `createCssContext({ id, classNameSlug, onInvalidSlug })` returns the `css`, `cx`, `keyframes`, `viewTransition` and `Style` functions. A `css` call yields a class name; the styles themselves are delivered lazily through the HTML callback mechanism: the first time a class is rendered in a given tree, a callback adds the rule to a `<style id="…">` element if the buffer already holds one, and otherwise prepends a small script that appends the text to that element. Class names coming from `cx` are escaped, since they are marked as already escaped but may carry untrusted text. The `Style` component renders the `<style>` element, accepting a `nonce`.

Sources: [src/helper/css/index.ts:39-61](repo://src/helper/css/index.ts#L39-L61), [src/helper/css/index.ts:72-146](repo://src/helper/css/index.ts#L72-L146), [src/helper/css/index.ts:149-155](repo://src/helper/css/index.ts#L149-L155)

## Proxying

`proxy(input, init)` is a `fetch` wrapper for forwarding. `init.raw` can be the incoming `Request`, whose method, body, headers and signal are copied; the standard hop-by-hop headers (`connection`, `keep-alive`, `transfer-encoding`, `upgrade`, …) are removed. With `strictConnectionProcessing: true` it also removes headers named in `Connection`, and it throws `HTTPException(400)` if one of those names is not a valid token. Headers given as an object may be `undefined` to delete one. It removes `accept-encoding` from the outgoing request, so the upstream responds uncompressed, uses `customFetch` instead of `fetch` if given, and on the way back drops hop-by-hop headers and, when `content-encoding` is present, that header and `content-length`.

Sources: [src/helper/proxy/index.ts:10-22](repo://src/helper/proxy/index.ts#L10-L22), [src/helper/proxy/index.ts:50-113](repo://src/helper/proxy/index.ts#L50-L113), [src/helper/proxy/index.ts:160-190](repo://src/helper/proxy/index.ts#L160-L190)

## Matched routes

`matchedRoutes(c)` reads the match result stored on the request and returns every `RouterRoute` that matched. `routePath(c, index?)` returns the path pattern of the currently running route (or the one at `index`), and `baseRoutePath` the base path it was registered under. `basePath(c)` returns the base path with parameters filled in from the actual URL, computed by matching each pattern segment against the request path and cached per context.

Sources: [src/helper/route/index.ts:32-34](repo://src/helper/route/index.ts#L32-L34), [src/helper/route/index.ts:58-59](repo://src/helper/route/index.ts#L58-L59), [src/helper/route/index.ts:82-83](repo://src/helper/route/index.ts#L82-L83), [src/helper/route/index.ts:106-141](repo://src/helper/route/index.ts#L106-L141)

## Streaming responses

All three streaming helpers create a `TransformStream`, wrap it in a `StreamingApi`, run your callback in the background, and return `c.newResponse(stream.responseReadable)`. The callback's errors go to `onError` (or `console.error`), and the stream is always closed afterwards. The context is kept in a `WeakMap` because Bun destroys it once the response is returned, and on old Bun versions an abort listener is added because Bun did not call `cancel()` there.

Sources: [src/helper/streaming/stream.ts:5-45](repo://src/helper/streaming/stream.ts#L5-L45), [src/helper/streaming/utils.ts:1-11](repo://src/helper/streaming/utils.ts#L1-L11)

- `stream(c, cb, onError)` is the plain version.
- `streamText(c, cb, onError)` first sets `Content-Type: text/plain; charset=UTF-8`, `X-Content-Type-Options: nosniff` and `Transfer-Encoding: chunked`, then calls `stream`.
- `streamSSE(c, cb, onError)` sets `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive` and chunked encoding, and passes an `SSEStreamingApi` whose `writeSSE({ data, event, id, retry })` writes `data:` lines for each line of the data, plus the optional fields, ending with a blank line. `event`, `id` and `retry` must not contain line breaks. If the callback fails and an `onError` handler exists, it is run and an `event: error` message with the error message is written.

Sources: [src/helper/streaming/text.ts:6-15](repo://src/helper/streaming/text.ts#L6-L15), [src/helper/streaming/sse.ts:13-68](repo://src/helper/streaming/sse.ts#L13-L68), [src/helper/streaming/sse.ts:72-100](repo://src/helper/streaming/sse.ts#L72-L100)

## Development and testing

`inspectRoutes(app)` lists `app.routes` with each handler's name (its function name, or `[middleware]` / `[handler]`) and whether it is middleware; `showRoutes(app, { verbose, colorize })` prints them in aligned columns, hiding middleware unless `verbose` is set. `getRouterName(app)` triggers a match on `GET /` so a `SmartRouter` has chosen its router, and returns the router's name ([[Router Interface and SmartRouter]]).

Sources: [src/helper/dev/index.ts:23-79](repo://src/helper/dev/index.ts#L23-L79)

`testClient(app, env?, executionCtx?, options?)` is `hc` bound to `http://localhost` with a custom `fetch` that calls `app.request(input, init, env, executionCtx)`, so typed client calls run in-process against the app ([[RPC Client (hc)]]).

Sources: [src/helper/testing/index.ts:16-27](repo://src/helper/testing/index.ts#L16-L27)
