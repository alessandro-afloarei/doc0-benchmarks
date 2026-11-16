---
title: "Typed Client"
---
## Overview

`hc()` returns a proxy that mirrors the route tree of an app. Each property read adds a segment to a path, and a call on the final property sends a request. The app's type, described in [[Type Inference]], gives the proxy its types, so `client.posts.$get({ query })` is checked against the schema of the `GET /posts` route. At run time there is no generated code: the path and the method come from the property names, and the request is an ordinary `fetch` call.

Sources: [src/client/client.ts:133-137](repo://src/client/client.ts#L133-L137)

## Building the path

`createProxy` returns a function-backed `Proxy`. A property read returns a new proxy with the key appended to `path`, and a call on the proxy runs the callback with the collected path and the call arguments. A `then` read returns `undefined`, so the proxy is not treated as a promise when it is awaited by mistake.

Sources: [src/client/client.ts:15-31](repo://src/client/client.ts#L15-L31)

`hc(baseUrl, options)` passes the callback to `createProxy`. The callback joins the path segments with `/` and merges them onto the base URL with `mergePath`, so `hc('http://localhost/api').posts` builds the URL `http://localhost/api/posts`.

Sources: [src/client/client.ts:133-137](repo://src/client/client.ts#L133-L137), [src/client/client.ts:169-170](repo://src/client/client.ts#L169-L170), [src/client/utils.ts:11-16](repo://src/client/utils.ts#L11-L16)

The `toString()` and `valueOf()` reads are answered locally, so printing a segment for debugging never sends a request.

Sources: [src/client/client.ts:138-160](repo://src/client/client.ts#L138-L160)

## Choosing the method

A final segment that begins with `$` is the method: `$get`, `$post` and so on. The callback removes that segment from the path and keeps its name for the request. A call without a `$` segment returns the `ClientRequestImpl` object instead, so the caller can use it directly.

Sources: [src/client/client.ts:161-168](repo://src/client/client.ts#L161-L168), [src/client/client.ts:228-232](repo://src/client/client.ts#L228-L232)

The special segments `$url`, `$path` and `$ws` do not send a request. `$url` returns a `URL` with the path parameters and query filled in, `$path` returns the same path without the base, and `$ws` opens a `WebSocket` with the protocol changed to `ws`.

Sources: [src/client/client.ts:171-186](repo://src/client/client.ts#L171-L186), [src/client/client.ts:187-200](repo://src/client/client.ts#L187-L200)

## Request arguments

`ClientRequestImpl` holds the URL, the method and the body, and its `fetch` method takes the arguments of the call. A `query` object is turned into search parameters, a `form` object into `FormData` with each array value appended as repeated entries, and a `json` object into a JSON string with the `application/json` type.

Sources: [src/client/client.ts:33-52](repo://src/client/client.ts#L33-L52), [src/client/client.ts:53-90](repo://src/client/client.ts#L53-L90)

`param` replaces the `:name` segments of the URL, `header` is merged into the request headers, and `cookie` is serialized into a single `Cookie` header with `serialize`.

Sources: [src/client/client.ts:91-106](repo://src/client/client.ts#L91-L106), [src/client/utils.ts:18-24](repo://src/client/utils.ts#L18-L24)

The body is attached only for methods other than `GET` and `HEAD`. The URL has a trailing `index` segment removed and its query string appended before the call, so `/posts/index` and `/posts` are the same request.

Sources: [src/client/client.ts:107-127](repo://src/client/client.ts#L107-L127), [src/client/utils.ts:55-60](repo://src/client/utils.ts#L55-L60)

```ts
const client = hc<typeof app>('http://localhost:8787')
const res = await client.posts.$post({ json: { title: 'Hello' } })
```

Sources: [src/client/client.ts:53-90](repo://src/client/client.ts#L53-L90), [src/client/client.ts:214-229](repo://src/client/client.ts#L214-L229)

## Options

Options given to `hc()` and options given to a call are merged with `deepMerge`, and the call's values take precedence. Headers are the exception: when both sides supply headers, they are combined into one function that merges the two sets, so a per-call header does not replace the client-wide ones.

Sources: [src/client/client.ts:214-229](repo://src/client/client.ts#L214-L229), [src/client/utils.ts:66-70](repo://src/client/utils.ts#L66-L70)

The `fetch` option replaces the global `fetch` used for that call, so a caller can send the request somewhere other than the network. The `webSocket` option replaces the `WebSocket` constructor used by `$ws`.

Sources: [src/client/client.ts:123-127](repo://src/client/client.ts#L123-L127), [src/client/client.ts:187-200](repo://src/client/client.ts#L187-L200), [src/client/types.ts:32-34](repo://src/client/types.ts#L32-L34)

## Responses

A `$`-method call returns the `Response` from `fetch`, unchanged. `parseResponse` hands that response to `fetchRP`, which detects whether the body is JSON or text, reads it, and stores it on the response as `_data`. A response whose status is not `ok` throws a `DetailedError` that carries the status and the parsed data.

Sources: [src/client/utils.ts:92-113](repo://src/client/utils.ts#L92-L113), [src/client/fetch-result-please.ts:14-30](repo://src/client/fetch-result-please.ts#L14-L30), [src/client/fetch-result-please.ts:46-55](repo://src/client/fetch-result-please.ts#L46-L55), [src/client/fetch-result-please.ts:80-86](repo://src/client/fetch-result-please.ts#L80-L86)
