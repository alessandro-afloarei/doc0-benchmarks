---
type: integration
title: RPC Client (hc)
description: How the hono/client hc function turns an app's route schema into a typed, Proxy-based HTTP client — path chaining, $method calls, request building for query/param/json/form/header/cookie, $url/$path/$ws, header and fetch options, parseResponse, and type utilities like InferRequestType and PickResponseByStatusCode.
tags: [client, rpc, hc, types, fetch]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T08:25:20.453Z
sources:
  - id: openwiki-source-fcbdfb5eaab568f04bde39d5
    resource: repo://src/client/client.ts
  - id: openwiki-source-af57a068e7b3792cc509bb62
    resource: repo://src/client/fetch-result-please.ts
  - id: openwiki-source-4e10f69834474e54fbf1a58f
    resource: repo://src/client/types.ts
  - id: openwiki-source-e55496b6dec0986c8ee44315
    resource: repo://src/client/utils.ts
generated: { by: "claude-code", at: "2026-11-15T08:25:20.453Z" }
---

# RPC Client (hc)

`hc<typeof app>(baseUrl, options?)` (`src/client/client.ts`, exported from `hono/client`) gives frontends and other services a typed client for a Hono app **without code generation**. Types come entirely from the server's accumulated `Schema` (see [Type System](../concepts/type-system.md)); at runtime the client is a small `Proxy` that builds a URL and calls `fetch`.

```ts
// server
const route = app.post('/posts/:id', validator('json', ...), (c) => c.json({ ok: true }, 201))
export type AppType = typeof route

// client
const client = hc<AppType>('http://localhost:8787')
const res = await client.posts[':id'].$post({ param: { id: '1' }, json: { title: 'x' } })
if (res.ok) { const data = await res.json() } // typed
```

## Runtime mechanism

`createProxy(callback, path)` returns a `Proxy` over a function:

- Each property access appends the key to `path` and returns a new proxy (`then` returns `undefined`, so a proxy is never treated as a thenable by `await`).
- Calling the proxy invokes `proxyCallback({ path, args })`.

`proxyCallback` then:

1. Handles `toString()` / `valueOf()` (and `.name.toString()`, which yields the last path segment).
2. If the last segment starts with `$`, pops it as the method (`$get` → `get`).
3. Joins the remaining segments with `/` and merges with `baseUrl`. The segment `index` maps to the root of its directory (`removeIndexString`), which is how `/` routes are exposed as `client.index.$get()`.
4. Special methods:
   - `$url(args?)` → a `URL` object with params replaced and query appended.
   - `$path(args?)` → the same as a path string relative to `baseUrl`.
   - `$ws(args?)` → converts `http(s)` to `ws(s)`, appends query values (arrays as repeated keys), and opens `new WebSocket(url)` or the `options.webSocket` factory.
5. Otherwise builds a `ClientRequestImpl` and calls its `fetch(args, mergedOptions)`. Per-call options are deep-merged over the client-level options; when both define `headers`, they are combined in an async function (per-call wins).

## Request construction

`ClientRequestImpl.fetch(args, opt)` maps validator targets to the wire:

| Arg | Effect |
| --- | --- |
| `param` | Replaces `/:name`, `/:name{regex}` and `/:name?` segments; an empty/undefined value removes the segment. |
| `query` | `options.buildSearchParams` or the default (`undefined` skipped, arrays appended as repeated keys). |
| `json` | `JSON.stringify` body + `Content-Type: application/json`. |
| `form` | A `FormData` (arrays appended per value, `undefined` skipped). |
| `header` | Merged into headers before `options.headers` (which may be an async function). |
| `cookie` | Serialized and joined into a `Cookie` header. |

The body is omitted for `GET` and `HEAD`. The URL is passed to `fetch` as a **string** (for MSW/node-fetch compatibility), and `opt.init` is spread last, so it can override `method`, `headers` and `body`. `opt.fetch` can be any fetch-compatible function, including `app.request` — this is how [`testClient`](../helpers/overview.md#testing) runs the app in-process.

## Types

- `Client<T, Prefix>` converts each schema path into nested objects via `PathToChain` (`/posts/:id` → `client.posts[':id']`, empty segment → `index`).
- `ClientRequest` exposes one `$method` per endpoint; the `args` parameter is required only if the endpoint input has required keys. `$all` endpoints are expanded to all standard methods.
- `ClientResponse<T, Status, Format>` mirrors `Response` but types `status`, `ok` (literal `true` for 2xx, `false` otherwise), `json()` (only for `json` format) and `text()`.
- `$ws` exists only when the `$get` endpoint has `outputFormat: 'ws'` (from `upgradeWebSocket`).
- `InferRequestType<typeof client.x.$post>` / `InferResponseType<..., Status?>` extract input and output types.
- `ApplyGlobalResponse<App, { 500: { json: {...} } }>` adds globally handled responses (e.g. from `onError`) to every endpoint; `PickResponseByStatusCode<App, 200>` keeps only selected statuses.

Because types flow from the value returned by chained route definitions, servers must export the type of the **chained** expression (or of sub-apps mounted via `app.route()`, which uses `MergeSchemaPath`).

## parseResponse

`parseResponse(client.x.$get())` (`src/client/utils.ts`, built on a trimmed copy of `fetch-result-please` in `src/client/fetch-result-please.ts`) awaits the response, reads the body as JSON when the content type is `application/json` or `application/*+json` (text otherwise, nothing for 101/204/205/304), and throws `DetailedError` with `statusCode` and `detail: { data, statusText }` when `!res.ok`. Its return type excludes 4xx/5xx variants.

## Tests

- `src/client/client.test.ts` – runtime behavior against an MSW server and in-process apps (URL building, headers, cookies, forms, `$url`/`$path`/`$ws`, index routes).
- `src/client/types.test.ts` – type-level inference for params, queries, status-specific responses, global responses.
- `src/client/utils.test.ts` – `replaceUrlParam`, `removeIndexString`, `deepMerge`, `parseResponse`.
