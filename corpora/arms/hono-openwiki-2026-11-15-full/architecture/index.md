# Files

- [Context and HonoRequest](context-and-request.md) - How Hono's per-request Context object builds responses, carries variables, env bindings and execution context, and how HonoRequest exposes params, query, headers, cached body parsing and validated data.
- [Architecture Overview](overview.md) - Map of the Hono framework's source tree, the HonoBase/Hono split, router presets (default, hono/tiny, hono/quick), the subpath export surface for npm and JSR, and how core, middleware, helpers, JSX, client and adapters relate.
- [Request Lifecycle and Middleware Composition](request-lifecycle.md) - Step-by-step flow of a request through Hono — route registration, path extraction, router matching, Context creation, the single-handler fast path, koa-style compose(), error and not-found handling, HEAD handling, and the semantics of route(), basePath() and mount().
