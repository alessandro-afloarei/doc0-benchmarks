---
title: "RPC Client (hc)"
---
## Overview

`hc` from `hono/client` returns an object whose shape mirrors your app's routes. Calling `client.api.posts.$get({ query })` sends a real HTTP request to `GET /api/posts` and returns the `fetch` `Response`. There is no code generation: at runtime the client is a recursive `Proxy` that collects property names into a path, and at compile time the `Client<T, Prefix>` type derives the same shape from the app's schema type, which the routes and validators accumulate ([[Validator and Typed Routes]]).

Sources: [src/client/client.ts:15-31](repo://src/client/client.ts#L15-L31), [src/client/client.ts:133-138](repo://src/client/client.ts#L133-L138), [src/client/types.ts:311-318](repo://src/client/types.ts#L311-L318)

```ts
const client = hc<typeof app>('http://localhost:8787')
const res = await client.api.posts[':id'].$get({ param: { id: '1' } })
```

Sources: [src/client/client.ts:133-138](repo://src/client/client.ts#L133-L138), [src/client/client.ts:86-89](repo://src/client/client.ts#L86-L89)

## The proxy

`createProxy(callback, path)` returns a `Proxy` over an empty function. Reading any string property other than `then` returns a new proxy with that key appended to `path`, and calling the proxy invokes `callback({ path, args })`. Excluding `then` stops `await client.foo` from treating the proxy as a thenable.

Sources: [src/client/client.ts:15-31](repo://src/client/client.ts#L15-L31)

`hc(baseUrl, options)` supplies the callback. It first handles `toString` and `valueOf` calls, returning the property name before them or the callback itself, so inspection tools do not trigger requests. It then looks at the last path part: if it starts with `$`, that part is popped and, with the `$` removed, is the method. Remaining parts are joined with `/` and merged onto `baseUrl` with `mergePath`.

Sources: [src/client/client.ts:137-170](repo://src/client/client.ts#L137-L170)

A method resolves in one of four ways:

Sources: [src/client/client.ts:171-232](repo://src/client/client.ts#L171-L232)

| Method | Result |
| --- | --- |
| `$url`, `$path` | The URL (as a `URL`) or the path string only; `param` and `query` arguments are applied, and a trailing `index` segment is dropped |
| `$ws` | A `WebSocket` for the URL with `http` replaced by `ws`; query values are appended; `options.webSocket` can supply the constructor |
| any other (`$get`, `$post`, …) | A request: `new ClientRequestImpl(url, method, …)` then `fetch(args[0], mergedOptions)` |
| none (no `$`) | The `ClientRequestImpl` itself |

Sources: [src/client/client.ts:171-232](repo://src/client/client.ts#L171-L232), [src/client/utils.ts:46-64](repo://src/client/utils.ts#L46-L64)

## Building the request

`ClientRequestImpl.fetch(args, opt)` turns the call arguments into a `fetch` call. The argument keys match the validation targets on the server:

Sources: [src/client/client.ts:53-112](repo://src/client/client.ts#L53-L112)

- `query` goes through `buildSearchParams` (arrays become repeated keys; `undefined` is skipped), which `options.buildSearchParams` can replace.
- `form` is added to a `FormData`, one append per array element.
- `json` is `JSON.stringify`-ed and sets `Content-Type: application/json`.
- `param` fills `:name` placeholders in the URL through `replaceUrlParam`, which understands `:name{regex}` and optional `?` forms.
- `header` is merged with `opt.headers`, which may be a function (sync or async); `cookie` values are serialised into a `Cookie` header.

Sources: [src/client/client.ts:53-112](repo://src/client/client.ts#L53-L112), [src/client/utils.ts:18-44](repo://src/client/utils.ts#L18-L44)

The URL gets any `/index` suffix removed, the path parameters substituted and the query string appended. The body is only sent for methods other than `GET` and `HEAD`. The call goes to `opt.fetch` or the global `fetch`, with `opt.init` spread last so it overrides everything Hono sets.

Sources: [src/client/client.ts:110-129](repo://src/client/client.ts#L110-L129)

```ts
return (opt?.fetch || fetch)(url, {
  body: setBody ? this.rBody : undefined,
  method: methodUpperCase,
  headers: headers,
  ...opt?.init,
})
```

Sources: [src/client/client.ts:110-129](repo://src/client/client.ts#L110-L129)

Passing a custom `fetch` is how the client is tested without a network: `opt.fetch` may be an app's `request` method, so the request goes straight into `app.fetch` ([[Application and Request Lifecycle]]).

Sources: [src/client/types.ts:32-34](repo://src/client/types.ts#L32-L34), [src/client/client.ts:123-128](repo://src/client/client.ts#L123-L128)

## Options and header merging

Options given to `hc` apply to every call, and the options given per call (second argument) are merged on top using `deepMerge`, which merges plain objects recursively and replaces other values. Headers get special handling: if both levels set `headers`, they are combined into one async function that resolves each (calling it if it is a function) and spreads the per-call result over the base result, so per-call headers win.

Sources: [src/client/client.ts:217-230](repo://src/client/client.ts#L217-L230), [src/client/utils.ts:66-82](repo://src/client/utils.ts#L66-L82)

## Reading responses

The client returns a normal `Response`. `parseResponse(promiseOrResponse)` in `src/client/utils.ts` wraps `fetchRP`, a trimmed copy of `fetch-result-please`: it reads the body unless the status is 101, 204, 205 or 304, choosing `json()` when the content type matches a JSON media type and `text()` otherwise, and throws a `DetailedError` (message `"<status> <statusText>"`, with `statusCode` and `detail.data`) for a non-OK response. The return type is inferred from the contentful, non-error responses in the route's schema.

Sources: [src/client/utils.ts:84-114](repo://src/client/utils.ts#L84-L114), [src/client/fetch-result-please.ts:7-95](repo://src/client/fetch-result-please.ts#L7-L95)

## Type-level pieces

`ClientRequestOptions` carries `fetch`, `webSocket`, `init`, `buildSearchParams` and `headers`. `ClientRequest<Prefix, Path, S>` maps each method in the schema to a function whose first parameter is the endpoint's `input` (optional when it has no required keys). `InferRequestType` and `InferResponseType` extract those types for a given call, and `ApplyGlobalResponse` and `PickResponseByStatusCode` adjust response unions by status code. The `$`-prefixed method names come from `ToSchema`, which wraps each method in `AddDollar`.

Sources: [src/client/types.ts:32-70](repo://src/client/types.ts#L32-L70), [src/client/types.ts:251-290](repo://src/client/types.ts#L251-L290), [src/client/index.ts:6-17](repo://src/client/index.ts#L6-L17), [src/types.ts:2500-2529](repo://src/types.ts#L2500-L2529)
