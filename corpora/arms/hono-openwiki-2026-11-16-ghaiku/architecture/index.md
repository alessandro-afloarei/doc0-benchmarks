# Files

- [Architecture Overview](overview.md) - Layered architecture of the Hono framework package - the HonoBase core, the per-preset Hono classes and their routers, the Context and HonoRequest objects, middleware composition, the validator, the typed client, JSX, helpers, and runtime adapters - and how these layers depend on one another.
- [Request Lifecycle](request-lifecycle.md) - Step-by-step trace of how a Web Standards Request becomes a Response in Hono - entrypoints (fetch, request, fire), HEAD handling, path extraction and strict mode, router matching, the single-handler fast path versus compose, not-found and error handling, and the finalization check.
