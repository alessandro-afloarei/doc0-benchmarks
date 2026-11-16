---
title: "Testing Apps"
---
## Overview

`testClient` lets a test call an app's routes with the typed client, without a server or a network. It returns the client from [[Typed Client]] with its `fetch` replaced by a function that calls the app directly. Each call therefore goes through the same dispatch that a deployed app uses, from `app.request` to the matched handlers. This page covers that wiring and the one extra entry point it relies on, `app.request`.

Sources: [src/helper/testing/index.ts:15-27](repo://src/helper/testing/index.ts#L15-L27)

## Building the client

`testClient(app, Env, executionCtx, options)` takes the app, optional bindings and execution context, and client options without `fetch`. It returns `hc` with the base URL `http://localhost`, and the replacement `fetch` is added to the options. Because the base URL is fixed, a test writes paths such as `/posts` and gets the same type checks as the production client.

Sources: [src/helper/testing/index.ts:16-26](repo://src/helper/testing/index.ts#L16-L26)

The replacement `fetch` takes the input and init that the client built, and passes them to `app.request` together with the bindings and the execution context. The client's options are passed through unchanged, except for `fetch`, which the helper overrides.

Sources: [src/helper/testing/index.ts:22-26](repo://src/helper/testing/index.ts#L22-L26)

## The request entry point

`app.request(input, requestInit, Env, executionCtx)` accepts a `Request`, a string or a `URL`. A string or `URL` that does not start with `http` or `https` is joined onto `http://localhost` with `mergePath`, so `app.request('/hello')` builds the request for `http://localhost/hello`. A `Request` is passed on with `requestInit` applied to it, if one is given.

Sources: [src/hono-base.ts:499-517](repo://src/hono-base.ts#L499-L517)

The result is whatever `fetch` returns, a `Response` or a promise of one. Since the client's `fetch` returns that value, a test can `await` the client call and read the status, headers and body as it would from a server. A test that needs the bindings sets them in the `Env` argument, and those values reach the handlers as `c.env`.

Sources: [src/hono-base.ts:479-485](repo://src/hono-base.ts#L479-L485), [src/helper/testing/index.ts:22-24](repo://src/helper/testing/index.ts#L22-L24)

## What a test does not cover

Because the client calls `app.request` directly, a test does not pass through the runtime adapter, so the server, the connection and the runtime's own `fetch` handling are not exercised. A runtime-specific behaviour, such as the WebSocket upgrade in [[WebSockets]], needs a test in that runtime. The repository's own suites for each runtime are on [[Test Suites]].

Sources: [src/helper/testing/index.ts:22-24](repo://src/helper/testing/index.ts#L22-L24), [src/hono-base.ts:479-485](repo://src/hono-base.ts#L479-L485)
