---
type: api
title: Typed RPC Client (hc)
description: How the hc client in src/client builds a typed fetch proxy from an app's route types, how calls become URLs, bodies, headers, and cookies, how url, path, and ws accessors work, and how InferRequestType, InferResponseType, parseResponse, and DetailedError type and handle responses.
tags: [hono, client, rpc, hc, fetch, typescript, types, websocket]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T18:18:42.046Z
sources:
  - id: openwiki-source-fcbdfb5eaab568f04bde39d5
    resource: repo://src/client/client.ts
  - id: openwiki-source-af57a068e7b3792cc509bb62
    resource: repo://src/client/fetch-result-please.ts
  - id: openwiki-source-e55496b6dec0986c8ee44315
    resource: repo://src/client/utils.ts
generated: { by: "claude-code", at: "2026-11-16T18:18:42.046Z" }
---

# Typed RPC Client (hc)

`hc` is Hono's typed client. You pass it a base URL and get back a proxy whose property chain mirrors the route paths of an app's type. Calling a method on the proxy performs a `fetch` request with the matching URL, method, and validated inputs. The client never imports the server code at runtime: the only link is the `typeof app` type, so a client bundle can import types from the server module without pulling in the server. The implementation is in `src/client/client.ts`, with helpers in `src/client/utils.ts` and response handling in `src/client/fetch-result-please.ts`.

## Creating a client

```ts
const client = hc<typeof app>('http://localhost:8787/')
const res = await client.posts[':id'].$get({ param: { id: '1' }, query: { lang: 'en' } })
```

`hc` is `createProxy(function proxyCallback(opts) {...})` with a base URL and optional `ClientRequestOptions` (for example `headers`, a custom `fetch`, or a `webSocket` factory). Each property access extends `opts.path`; the call at the end provides `opts.args`.

## How a call is interpreted

`proxyCallback` in `client.ts` turns the accumulated path and last call into one of four actions:

1. **`toString` and `valueOf` accessors.** `client.posts.toString()` returns the callback source. Accessing `.name` returns the last path segment, which helps with logging.
2. **`$url` and `$path` accessors.** Return the URL object or the path string without fetching. `replaceUrlParam` fills in `param` values and `query` is serialized with `buildSearchParams`. `removeIndexString` drops a trailing `/index` segment.
3. **`$ws` accessor.** Converts the URL to `ws:` or `wss:` (`replaceUrlProtocol`), appends query parameters (arrays are appended as repeated keys), and opens a `WebSocket`. An `options.webSocket` factory can replace the constructor.
4. **HTTP method accessors** such as `$get`, `$post`, and `$put`. The method is taken from the last path segment with a leading `$`. The remaining segments form the URL path, which is joined onto the base URL with `mergePath`. A `ClientRequestImpl` is created, and `options` are merged with the per-call options (`opts.args[1]`) using `deepMerge`. If both base and per-call `headers` are set, they are combined into one function that awaits both.

Property access alone never sends anything: the proxy only runs the callback when it is called, so a path chain is extended by property access and a request is made only by calling a `$`-method. Calling a path without a `$`-method suffix returns a bare `ClientRequestImpl` without sending a request.

## Building the request

`ClientRequestImpl.fetch(args, opt)` assembles the request from the validated-input shape:

- `query` is turned into `URLSearchParams` through the configured `buildSearchParams` function.
- `form` is converted into `FormData`. Array values are appended as repeated fields, and `undefined` entries are skipped.
- `json` is serialized with `JSON.stringify` and sets `Content-Type: application/json`. It takes precedence over `form` only if both are given, because it is checked later and overwrites the body.
- `param` replaces `:name` placeholders in the URL.
- `header` values are merged with the client's and call-level `headers` options (functions are awaited).
- `cookie` values are serialized with Hono's own `serialize` from `src/utils/cookie.ts`, with `path: '/'`, and joined with commas into a single `Cookie` header.
- The final URL has `removeIndexString` and parameter replacement applied; the query string is appended last.
- `GET` and `HEAD` never receive a body. Other methods get the prepared body.
- The request is sent with `fetch` (or the configured `fetch` override) and the response is returned for further processing.

<!-- openwiki: broken internal link [/openwiki/validation/validator.md] link "/openwiki/validation/validator.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
The inputs accepted by a call are the types produced by `validator` on the server, so an argument that does not match the route's validator fails at compile time (see [Validator Middleware and Input Types](/openwiki/validation/validator.md)).

## Response typing

`src/client/types.ts` extracts types from a client method:

- `InferRequestType<T>` returns the argument type of a client method, typed as `NonNullable<R>` when `T` is a function returning `Promise<ClientResponse>`.
- `InferResponseType<T, U>` returns the output type of the endpoint for status code `U`, defaulting to all status codes. It works through `InferEndpointType`, which unions the endpoint definitions from the app's routes.
- `ClientRequestOptions` describes `fetch`, `webSocket`, `headers`, and standard `RequestInit` fields. Anything passed in `RequestInit` has the highest priority and can override headers or body that the client set.

## Parsing responses

`src/client/utils.ts` exports `parseResponse(promise)`. It awaits the response and then:

- Delegates to `fetchRP` in `fetch-result-please.ts`, which reads the body using a response type detected from the content type and stores it.
- Throws `DetailedError` for non-`ok` statuses, with the status code and the already-read body in `detail`, so a caller can catch the error and inspect it.
- Returns the body typed by `parseResponse`'s conditional type. The type removes error status codes from the union, so the success type is the body type for successful statuses only; if no successful status is contentful, the return type is `undefined`.

`DetailedError` is exported from `hono/client` alongside `parseResponse`.

## Invariants and consequences

- The client's paths must match the server route type, so renaming a route changes the client's type and any call site fails to compile.
- Path parameters are substituted by `replaceUrlParam` as raw strings: each `:name` segment is replaced with its value, and an optional segment with no value is removed. The client does not apply its own percent-encoding to them.
- The `$url`, `$path`, and `$ws` accessors do not send requests and can be used to construct links.
- Any response with a status outside the 2xx range makes `parseResponse` throw, but `client.posts.$get()` itself returns the raw `Response` unless `parseResponse` is applied.

## Representative tests

- `src/client/client.test.ts` covers the proxy, URL building, and request assembly.
- `src/client/types.test.ts` covers the inference helpers, and `src/client/utils.test.ts` covers the utilities.

## Related pages

<!-- openwiki: broken internal link [/openwiki/validation/validator.md] link "/openwiki/validation/validator.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Validator Middleware and Input Types](/openwiki/validation/validator.md)
<!-- openwiki: broken internal link [/openwiki/architecture/overview.md] link "/openwiki/architecture/overview.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Architecture Overview](/openwiki/architecture/overview.md)
