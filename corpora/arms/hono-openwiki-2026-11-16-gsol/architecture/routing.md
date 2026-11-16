---
type: architecture
title: Routing strategies and application composition
description: Router selection and match contracts, path semantics, presets, grouped Hono applications, and external fetch-handler mounting.
tags: [routing, architecture, composition, presets]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T06:16:56.556Z
sources:
  - id: openwiki-source-5b3210e04e23e6aecc8c0eb5
    resource: repo://src/hono-base.ts
  - id: openwiki-source-bd5d0ff875be61061f6867c2
    resource: repo://src/hono.ts
  - id: openwiki-source-aeafc812676cb9e06a3065ab
    resource: repo://src/preset/quick.ts
  - id: openwiki-source-117f1edff7a7c593d32fbc14
    resource: repo://src/preset/tiny.ts
  - id: openwiki-source-209701b9ea297311fec3e1d8
    resource: repo://src/router/smart-router/router.ts
  - id: openwiki-source-c0c053b6ce719d3c6d08c6e6
    resource: repo://src/utils/url.ts
generated: { by: "codex", at: "2026-11-16T06:16:56.556Z" }
---

# Routing strategies and application composition

Hono separates application behavior from path matching. [HonoBase](../../src/hono-base.ts) records handlers and dispatches requests; a [Router](../../src/router.ts) implements `add(method, path, handler)` and `match(method, path)`. Match results contain an ordered handler list and parameters, rather than a single winning endpoint. This lets middleware and endpoints share the same dispatch mechanism.

## Default and preset routers

| Import | Router configuration | Consequence |
| --- | --- | --- |
| `hono` | SmartRouter with RegExpRouter, then TrieRouter | Tries the compiled matcher first, falling back for unsupported route patterns. |
| `hono/quick` | SmartRouter with LinearRouter, then TrieRouter | Uses a different first candidate while preserving fallback selection. |
| `hono/tiny` | PatternRouter | Uses one direct strategy. |
| `hono/hono-base` | No default router | The caller or subclass must supply a router. |

The default `Hono` constructor honors `options.router`. In the current tiny and quick presets, the constructor assigns the preset router after calling `super`; those implementations do not preserve an injected router option. See [default Hono](../../src/hono.ts), [quick](../../src/preset/quick.ts), and [tiny](../../src/preset/tiny.ts).

[SmartRouter](../../src/router/smart-router/router.ts) buffers registrations until the first match. It replays the entire route set into each candidate and attempts a match. Only `UnsupportedPathError` triggers fallback; unrelated errors propagate. On success it binds `match` directly to the selected router, discards the registration buffer, and exposes the active router. Accessing `activeRouter` before selection throws.

Register all routes before serving requests with SmartRouter. Once selection has occurred, `add()` throws the matcher-already-built error. An initial test request also triggers this transition. Router startup work and steady-state matching therefore have different costs and lifetimes.

## Matching and parameters

The common routing suite exercises static paths, `:name` parameters, regular-expression constraints, optional parameters, wildcards, all-method handlers, and registration ordering. For example:

```ts
app.use('/posts/*', async (c, next) => {
  await next()
})
app.get('/posts/:id', (c) => c.json({ id: c.req.param('id') }))
```

The returned handler order is significant: a handler that returns without calling `next()` stops traversal. Do not assume a more specific path will execute before an earlier terminal handler.

`Result<T>` supports two representations: direct parameter maps alongside handlers, or parameter-index maps plus a shared string stash. `HonoRequest.param()` resolves either form using the current `routeIndex`. A router implementation must preserve the per-handler parameter relationship as well as matching order; see [request state](../concepts/request-context-validation.md).

Strict path matching is the default. With `strict: false`, Hono uses `getPathNoStrict`, which removes a final slash from non-root paths. The constructor selects this getter instead of a custom getter in that configuration. With strict matching enabled, `getPath` can be overridden, and dispatch passes `{ env }` into it. Path extraction excludes query and fragment data and handles encoded paths in [URL utilities](../../src/utils/url.ts).

## Compose applications at registration time

`basePath('/api')` creates a wrapper sharing the router and route array, with a prefixed registration base. It is not an isolated application state container.

`app.route('/api', child)` copies the child's currently registered routes into the parent under the prefix. Populate the child before grouping it. Later additions to the child are not retroactively copied. Child custom error handlers are wrapped into copied handlers; the parent's not-found policy remains the surrounding application's fallback. The return type merges the child route schema into the parent, connecting runtime grouping to [typed clients](../workflows/typed-client.md).

```ts
const child = new Hono().get('/users/:id', (c) => c.json({ id: c.req.param('id') }))
const app = new Hono().route('/api', child)
```

For another framework's fetch-style handler, use `mount`. It registers all-method wildcard middleware, strips the mount prefix from the forwarded request by default, and passes environment plus execution context. `optionHandler` changes forwarded arguments; `replaceRequest` changes rewriting, and `false` preserves the original request. A returned response ends the chain; a missing response allows downstream handlers to run.

## Extension and verification

Custom routers implement the shared interface and should be checked against [common.case.test.ts](../../src/router/common.case.test.ts), which router-specific suites reuse. Compare the [SmartRouter suite](../../src/router/smart-router/router.test.ts) and neighboring implementations before changing support for a pattern. [Hono tests](../../src/hono.test.ts) verify grouping order, base paths, mounting, and custom path behavior above the router layer.

See [request lifecycle](request-lifecycle.md) for composition and failure handling, and [static generation](../workflows/static-assets-and-generation.md) for consumers of `app.routes`.
