---
type: architecture
title: RPC Client (hc)
description: How the hono/client hc function turns an app's type-level route schema into a typed fetch client — the recursive Proxy that maps property chains to URL paths, request construction for query/form/json/param/header/cookie, $url/$path/$ws, option merging, parseResponse/DetailedError, and the inference helper types.
tags: [client, rpc, hc, typescript, proxy]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T17:08:50.203Z
sources:
  - id: openwiki-source-fcbdfb5eaab568f04bde39d5
    resource: repo://src/client/client.ts
  - id: openwiki-source-af57a068e7b3792cc509bb62
    resource: repo://src/client/fetch-result-please.ts
  - id: openwiki-source-4e10f69834474e54fbf1a58f
    resource: repo://src/client/types.ts
  - id: openwiki-source-e55496b6dec0986c8ee44315
    resource: repo://src/client/utils.ts
generated: { by: "claude-code", at: "2026-11-15T17:08:50.203Z" }
---

# RPC Client (`hc`)

`hono/client` (`src/client/`) provides `hc<typeof app>(baseUrl, options?)`: a client whose **types** come from the server app's `Schema` (built by the [type system](type-system.md) and [validators](../validation/validator.md)) and whose **runtime** is a tiny `Proxy` around `fetch`. There is no code generation and no runtime knowledge of the routes — any property chain produces a request.

```ts
const client = hc<typeof app>('http://localhost:8787')
const res = await client.posts[':id'].$get({ param: { id: '1' }, query: { draft: 'false' } })
const data = await res.json() // typed from c.json(...) in the handler
```

## Runtime: a recursive Proxy (`client.ts`)

`createProxy(callback, path)` returns a function-backed `Proxy`:

- **Property access** appends the key to the path and returns a new proxy. Non-string keys and `then` return `undefined`, so a proxy is never mistaken for a Promise when awaited.
- **Calling** the proxy invokes the callback with the accumulated `path` and arguments.

In the callback (`hc`):

1. `toString` / `valueOf` (and `.name`) are special-cased so proxies behave sensibly when stringified.
2. If the last segment starts with `$`, it is popped and becomes the method (`$get` → `get`, `$post`, `$url`, `$path`, `$ws`, or any custom `$method`).
3. The remaining segments are joined with `/` and merged onto `baseUrl` (`mergePath` normalizes slashes). The schema key `/` is exposed as `index`, and `removeIndexString` turns a trailing `/index` back into `/` (for a bare origin) or removes it.
4. Dispatch by method:
   - **`$url(args?)`** → a `URL` with params substituted and query appended.
   - **`$path(args?)`** → the same, as a path string relative to `baseUrl`.
   - **`$ws(args?)`** → a `WebSocket` to the URL with `http` replaced by `ws`, params substituted and query appended (`options.webSocket` can supply a custom constructor). The server side is the [`upgradeWebSocket` helper](../helpers/streaming-and-websocket.md).
   - **other `$method(args, reqOptions)`** → builds a `ClientRequestImpl` and calls `fetch`.

## Request construction (`ClientRequestImpl.fetch`)

The first argument mirrors the server's validation targets:

| Arg | Effect |
| --- | --- |
| `param` | Replaces `/:name`, `/:name{regex}`, and optional `/:name?` segments (`replaceUrlParam`); an empty value removes the segment. |
| `query` | Serialized with `buildSearchParams` (arrays → repeated keys, `undefined` skipped) or a custom `options.buildSearchParams`. |
| `form` | Builds `FormData` (arrays → repeated entries, `undefined` skipped). |
| `json` | `JSON.stringify` body and `Content-Type: application/json` (overrides `form` if both are given). |
| `header` | Request headers. |
| `cookie` | Serialized with the cookie serializer (`Path=/`) into a `Cookie` header (entries joined with `,`). |

The body is omitted for `GET` and `HEAD`. The request is sent with `options.fetch` (or global `fetch`); `options.init` is spread **last** into the `RequestInit`, so it can override method, headers, and body.

### Options

`ClientRequestOptions` can be given globally to `hc` and per call as the second argument:

- `fetch` — custom fetch (e.g. `app.request` in [`testClient`](../helpers/utility-helpers.md#test-client--honotesting), or a service binding).
- `headers` — object or (async) function; per-call headers are merged over global ones (when both are functions/objects, a combined async function is created).
- `init` — extra `RequestInit` fields.
- `buildSearchParams`, `webSocket`.

Global and per-call options are combined with `deepMerge`.

## Responses

The returned value is the native `Response`, typed as `ClientResponse<T, Status, Format>`, a union over every status/format the handler can produce. Narrowing on `res.ok` or `res.status` narrows `res.json()`'s type.

`parseResponse(promise)` (from `hono/client`, implemented in `fetch-result-please.ts`) awaits the response, reads the body as JSON when the content type matches `application/json` or `application/*+json` (otherwise text), skips the body for 101/204/205/304, and **throws `DetailedError`** (with `statusCode` and `detail: { data, statusText }`) when `!res.ok`. Its return type excludes 4xx/5xx variants.

## Type-level API (`types.ts`)

- `Client<T, Prefix>` converts the app's schema keys into a nested object type (`PathToChain`) whose leaves are `ClientRequest`s with one `$method` per registered method plus `$url`/`$path`.
- `InferRequestType<typeof client.x.$post>` / `InferResponseType<..., Status?>` extract input and output types for use in UI code.
- `PickResponseByStatusCode<typeof app, 200>` and `ApplyGlobalResponse<typeof app, Def>` rewrite an app type to keep only some statuses or to add globally handled error responses to every route.

Typing large apps can be slow; the type-check performance measure in `perf-measures/type-check` guards this (see [Testing](../testing/testing-strategy.md)).

## Tests

`src/client/client.test.ts` (runtime behavior via mocked fetch and `app.request`), `src/client/types.test.ts` (type inference), and `src/client/utils.test.ts`.
