# Files

- [Context and HonoRequest](context-and-request.md) - How Hono's per-request Context builds responses, carries headers, status, variables, renderer and runtime bindings, and how HonoRequest exposes params, query, headers, cached body parsing and validated data.
- [Architecture Overview](overview.md) - Module map of the Hono web framework — core application classes and presets, routers, Context/HonoRequest, the type system and RPC client, validator, middleware, helpers, JSX and runtime adapters — and how they ship as package subpath exports.
- [Request Lifecycle and Composition](request-lifecycle.md) - End-to-end request flow in HonoBase — entrypoints (fetch, request, fire), path extraction, router matching, the single-handler fast path versus koa-style compose, error and not-found handling, HEAD handling — and how use/on/route/basePath/mount register routes.
