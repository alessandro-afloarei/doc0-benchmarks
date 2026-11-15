---
type: architecture
title: Context
description: The per-request Context object in src/context.ts — lazy HonoRequest, response builders (body/text/json/html/redirect/newResponse), header and status staging, the finalized flag and res setter merge semantics, typed variables, renderer/layout, env and executionCtx.
tags: [core, context, response, headers, variables, renderer]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T17:28:44.415Z
sources:
  - id: openwiki-source-663d89ccefa599120b60c70c
    resource: repo://src/context.ts
generated: { by: "claude-code", at: "2026-11-15T17:08:50.203Z" }
---

# Context

`Context` (`src/context.ts`) is the object passed as `c` to every handler and middleware. One instance is created per dispatched request by the application (see [Application Object and Request Dispatch](application.md)); adapters such as Cloudflare Pages' `handleMiddleware` also construct it directly. It is the meeting point of the incoming request, the bindings/env, per-request variables, and the outgoing response.

## Construction and request access

`new Context(request, { env, executionCtx, notFoundHandler, path, matchResult })` stores the raw request and options. `c.req` is created **lazily** on first access as `new HonoRequest(rawRequest, path, matchResult)`, so handlers that never touch `c.req` don't pay for it. See [HonoRequest](request.md).

- `c.env` — runtime bindings (Cloudflare bindings, Lambda event objects, Bun server, etc.), default `{}`.
- `c.executionCtx` — the `ExecutionContext` (`waitUntil`, `passThroughOnException`, `props`, `exports`); the getter **throws** `This context has no ExecutionContext` if none was supplied (e.g. in Node or `app.request` tests).
- `c.event` — the `FetchEvent` for Service Worker style apps; throws `This context has no FetchEvent` unless the execution context has `respondWith`.
- `c.error` — set by `compose` when a handler throws and an error handler runs, so outer middleware can inspect it after `await next()`.

## Response building

All builders go through a private `#newResponse(data, statusOrInit?, headers?)`:

1. Start from the current `c.res` headers if a response already exists, otherwise the **prepared headers** accumulated by `c.header()` before any response existed.
2. Merge headers from a `ResponseInit`/`Response` second argument (`Set-Cookie` is appended, others set).
3. Merge the third-argument header record (string values set; arrays replace then append each value).
4. Status is the numeric second argument, else `init.status`, else the value staged by `c.status()`.

Public helpers:

| Method | Behavior |
| --- | --- |
| `c.body(data, status?/init?, headers?)` | Raw body (`string`, `ArrayBuffer`, `Uint8Array`, `ReadableStream`, or `null`). |
| `c.text(text, ...)` | Adds `Content-Type: text/plain; charset=UTF-8`. Fast path: with no staged headers/status, no extra args and an unfinalized context it returns a bare `new Response(text)` (the platform default content type is also `text/plain;charset=UTF-8`). |
| `c.json(obj, ...)` | `JSON.stringify` with `Content-Type: application/json`; typed as `TypedResponse<JSONParsed<T>, U, 'json'>` for RPC. |
| `c.html(html, ...)` | `text/html; charset=UTF-8`. If given a promise/`HtmlEscapedString` object it resolves callbacks (`resolveCallback`, stringify phase) first and returns a `Promise<Response>`. |
| `c.redirect(location, status = 302)` | Sets `Location` (URI-encoding it only if it contains characters above `\xFF`) and returns an empty response. |
| `c.newResponse(...)` | Same as `body` without typed-response overloads. |
| `c.notFound()` | Invokes the app's not-found handler (or an empty `Response` when constructed without one). |

Explicit header arguments always override the default content-type, because defaults are spread first (`{ 'Content-Type': ..., ...headers }`).

The return types carry `TypedResponse` metadata — status code and format — which the [Type System](../typing/type-system.md) collects into the route schema for the [RPC client](../typing/rpc-client.md). Body-carrying helpers only accept `ContentfulStatusCode`s (e.g. not 204/304) at the type level.

## Headers, status, and `finalized`

- `c.header(name, value?, { append? })` writes to `c.res.headers` if a response exists, otherwise to the prepared `Headers`. `value === undefined` deletes the header. If the context is already finalized, the response is first cloned (`new Response(body, res)`) so headers become mutable even on responses that came from `fetch()`.
- `c.status(code)` stages a status for the next builder call; it doesn't modify an existing `c.res`.
- `finalized` becomes `true` whenever `c.res` is assigned. `compose` and dispatch use it to decide whether a handler produced a response.

### The `res` setter

Middleware often replaces the response after `await next()` (e.g. `c.res = new Response(...)`). The setter preserves headers set earlier: if a previous response exists, the new one is cloned and **every header of the old response except `content-type` is copied over**, with `set-cookie` values merged via `getSetCookie()` (replacing any `set-cookie` on the new response). This is why headers set by earlier middleware (CORS, security headers, cookies) survive when a later layer swaps the body. To deliberately drop them, set `c.res = undefined` first.

Reading `c.res` before any response exists lazily creates an empty `Response` backed by the prepared headers.

## Variables

`c.set(key, value)` / `c.get(key)` store per-request values in a lazily created `Map`. `c.var` returns a read-only plain object snapshot (`Object.fromEntries`). Typing comes from `Env['Variables']` and the globally augmentable `ContextVariableMap` interface; middleware like `jwt`, `requestId`, `language`, and `secureHeaders` (nonce) publish values this way. `hono/context-storage` can expose the current Context via `AsyncLocalStorage` (see [Request/Response Middleware](../middleware/request-response-middleware.md)).

## Renderer and layout

`c.render(...args)` calls the renderer installed with `c.setRenderer(fn)`; by default it is `(content) => c.html(content)`. The `ContextRenderer` interface can be augmented to type `c.render` (e.g. adding props). `c.setLayout` / `c.getLayout` hold a layout component used by the JSX renderer middleware for nested layouts. See [JSX Server Rendering](../jsx/server-rendering.md).

## Tests

`src/context.test.ts` covers header merging across `c.res` reassignment, set-cookie handling, status staging, the `text` fast path, `html` with async content, redirects, variables, and the execution-context getters.
