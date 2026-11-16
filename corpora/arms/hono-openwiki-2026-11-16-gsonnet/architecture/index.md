# Files

- [Architecture Overview](overview.md) - Package shape of Hono 4.x — HonoBase and its router-selecting presets, the many subpath exports, module layering (core, utils, helpers, middleware, adapters, JSX, client), and the Web-Standards-only design.
- [Request Lifecycle and Middleware Composition](request-lifecycle.md) - Step-by-step trace of how Hono's fetch() turns a Request into a Response — path extraction, router match, Context creation, the single-handler fast path, compose() onion execution, error and 404 handling, HEAD, and sub-app grouping via route/basePath/mount.
