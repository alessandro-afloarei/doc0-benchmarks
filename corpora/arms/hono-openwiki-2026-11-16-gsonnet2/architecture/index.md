# Files

- [Hono App Core: HonoBase, Presets and Route Registration](app-core.md) - How the HonoBase class registers routes and middleware, composes sub-apps with route(), basePath() and mount(), handles errors and 404s, and how the Hono, tiny and quick presets pick a router.
- [Context and HonoRequest](context-and-request.md) - How Context builds and merges responses, stores per-request variables and renderer/layout, and how HonoRequest resolves route params from the router match result, caches bodies and carries validated data.
- [Middleware Composition (compose)](middleware-composition.md) - How compose() in src/compose.ts chains matched handlers into an onion-style pipeline, including next() semantics, double-next detection, routeIndex tracking, error and not-found integration, and the single-handler fast path in HonoBase.
- [Request Lifecycle and Layering](request-lifecycle.md) - End-to-end trace of a request through Hono (adapter, fetch, dispatch, router match, Context, compose, response), including HEAD, 404 and error handling, plus the layering of core, routers, middleware, helpers and adapters.
