---
title: "Typed Client"
---
## Overview

`hc` builds a client whose method calls mirror the routes of an app. A call such as `client.posts.$get({ query: { page: '1' } })` sends a request to `/posts?page=1`. The client needs no code generation: `hc` is a function that takes the app's type as a type argument and returns a value whose shape the type describes at compile time, and whose runtime behaviour is a `Proxy` that records each property name as a path segment. This page covers that proxy, how a call turns into a `fetch`, and how a result is read. The types that describe the routes are on [[Type System]], and the input checks that the server runs are on [[Validation]].

Sources: [src/client/client.ts:133-136](repo://src/client/client.ts#L133-L136), [src/client/client.ts:15-31](repo://src/client/client.ts#L15-L31)

## Recording the path

`createProxy` returns a function wrapped in a `Proxy`. Each property read returns a new proxy with the name appended to `path`, and each call invokes the callback with the path and the arguments. Reading `then` returns `undefined`, so an `await` on a partial path does not run it as a promise.

Sources: [src/client/client.ts:15-31](repo://src/client/client.ts#L15-L31)

`hc` gives that proxy a callback. The callback joins the path with `/`, and it reads a trailing `$` name as the HTTP method, so `client.posts.$get` becomes the `GET` request for `posts`. Without a method name, the call returns a `ClientRequestImpl` that can build a URL, and `$url` and `$path` return the URL or path string without sending anything.

Sources: [src/client/client.ts:137-170](repo://src/client/client.ts#L137-L170), [src/client/client.ts:214-216](repo://src/client/client.ts#L214-L216)

The `toString` and `valueOf` names are answered by the callback itself, so that `hc().posts.name` and string conversion return the path name rather than a function. These checks run before the method is read.

Sources: [src/client/client.ts:142-159](repo://src/client/client.ts#L142-L159)

## Building the request

`ClientRequestImpl.fetch` receives the inputs of the call. A `query` value goes through `buildSearchParams`, which skips `undefined` values and repeats an array key. A `form` value becomes a `FormData`, and a `json` value is serialized and sets `Content-Type: application/json`. A `param` value replaces the matching `:name` segment with `replaceUrlParam`, and a `cookie` value is serialized into a `Cookie` header.

Sources: [src/client/client.ts:53-89](repo://src/client/client.ts#L53-L89), [src/client/client.ts:98-118](repo://src/client/client.ts#L98-L118), [src/client/utils.ts:18-43](repo://src/client/utils.ts#L18-L43)

Headers from the call are merged over the headers given to `hc`. The `headers` option can be a function that returns a promise, and the merge awaits it. The URL is cleaned of a trailing `/index` before the request is sent.

Sources: [src/client/client.ts:91-96](repo://src/client/client.ts#L91-L96), [src/client/client.ts:221-229](repo://src/client/client.ts#L221-L229), [src/client/utils.ts:55-60](repo://src/client/utils.ts#L55-L60)

The body is sent only for methods other than `GET` and `HEAD`. The request goes to `opt.fetch` when given, or to the global `fetch`, so a test can replace the transport. The `init` option is spread into the call last, so it can override the defaults.

Sources: [src/client/client.ts:119-128](repo://src/client/client.ts#L119-L128)

## WebSocket paths

The `$ws` name returns a `WebSocket` rather than a request. It converts the URL from `http` to `ws` with `replaceUrlProtocol`, adds the query, and creates the socket with the `webSocket` option when that is a function, or with the global `WebSocket` otherwise.

Sources: [src/client/client.ts:187-212](repo://src/client/client.ts#L187-L212), [src/client/utils.ts:46-53](repo://src/client/utils.ts#L46-L53)

## Reading the response

The client returns the raw `fetch` response. `parseResponse` and `fetchRP` read the body. `fetchRP` reads the body with a method chosen from the response, stores it, and throws a `DetailedError` with the status and the data when the status is not in the 2xx range. `parseResponse` is the typed wrapper that removes error statuses from the result type.

Sources: [src/client/fetch-result-please.ts:14-44](repo://src/client/fetch-result-please.ts#L14-L44), [src/client/utils.ts:92-104](repo://src/client/utils.ts#L92-L104)
