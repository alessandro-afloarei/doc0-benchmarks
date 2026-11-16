---
title: "Typed Client"
---
## Overview

`hc` builds a client for a Hono app. Its type comes from the app's route types, so a call such as `client.posts.$get()` can only name routes the app has. The client does not call the app directly: it builds a URL and calls `fetch`, which can be the global one, a custom function, or the app's own `request` in tests. The type of the client is computed from the app's type by the `Client` type, and the routes that type sees are the ones described in [[Registering Routes]]. The test helper that wraps the app is listed in [[Helper Catalogue]].

Sources: [src/client/client.ts:133-138](repo://src/client/client.ts#L133-L138), [src/client/types.ts:311-316](repo://src/client/types.ts#L311-L316), [src/client/index.ts:1-17](repo://src/client/index.ts#L1-L17)

## Building the URL

`hc` returns a proxy. Each property access adds a path segment, and a final `$get`, `$post` or similar names the HTTP method. The proxy joins the segments with the base URL, so `hc('http://localhost/api').posts.$get` targets `/api/posts`.

Sources: [src/client/client.ts:133-165](repo://src/client/client.ts#L133-L165)

The `$url` and `$path` names return the URL without sending a request. They apply the path parameters and query string that the caller passed, and `$url` returns a `URL` object while `$path` returns the path relative to the base. `$ws` opens a `WebSocket` to the URL with the scheme changed to `ws`, using a custom constructor when the `webSocket` option gives one.

Sources: [src/client/client.ts:166-210](repo://src/client/client.ts#L166-L210)

## Sending a request

For any other method the proxy creates a `ClientRequestImpl` with the URL and method, and passes the call's arguments to its `fetch`. Headers from the client options and from the call are merged, with the call's values winning. Options are merged with `deepMerge`, so nested options from the call override the base options without replacing the whole object.

Sources: [src/client/client.ts:211-232](repo://src/client/client.ts#L211-L232), [src/client/utils.ts:66-70](repo://src/client/utils.ts#L66-L70)

The request object holds the path parameters, query string and body for one call. Its `fetch` substitutes `:param` values into the URL, appends the query built by `buildSearchParams`, and sends the body with the content type it sets. The `fetch` option of `hc` is the function that actually performs the request.

Sources: [src/client/client.ts:33-48](repo://src/client/client.ts#L33-L48), [src/client/client.ts:49-70](repo://src/client/client.ts#L49-L70), [src/client/utils.ts:18-45](repo://src/client/utils.ts#L18-L45)

## Reading responses

`parseResponse` waits for the response, reads the body by its type, and returns the body only for a successful status. Its return type is filtered so the success type of the route is what the caller sees.

Sources: [src/client/utils.ts:89-110](repo://src/client/utils.ts#L89-L110)

`fetchRP` does the reading work for `parseResponse`. It reads the body once, using the response type it detects from the content type, and skips the body for statuses that cannot have one. A non-OK status throws a `DetailedError`, which carries the status code, the status text and the parsed body in `detail`.

Sources: [src/client/fetch-result-please.ts:24-44](repo://src/client/fetch-result-please.ts#L24-L44), [src/client/fetch-result-please.ts:46-60](repo://src/client/fetch-result-please.ts#L46-L60)

## Testing with the app

`testClient` wraps an app in `hc`. Its `fetch` option calls `app.request` with the bindings and execution context passed to `testClient`, so a test sends requests through the app's real dispatch path without starting a server.

Sources: [src/helper/testing/index.ts:16-27](repo://src/helper/testing/index.ts#L16-L27)

## Pages

- [[Registering Routes]] explains where the route types come from.
- [[Helper Catalogue]] lists `testClient` with the other helpers.

Sources: [src/client/types.ts:311-316](repo://src/client/types.ts#L311-L316)
