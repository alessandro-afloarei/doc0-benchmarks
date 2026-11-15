# Files

- [RPC Client (hc)](rpc-client.md) - How the hono/client hc function turns an app's type-level route schema into a typed fetch client — the recursive Proxy that maps property chains to URL paths, request construction for query/form/json/param/header/cookie, $url/$path/$ws, option merging, parseResponse/DetailedError, and the inference helper types.
- [Type System and Route Schema](type-system.md) - How src/types.ts makes Hono type-safe end to end — Env with Bindings and Variables, the generic parameters of HonoBase, handler/middleware overloads that thread Env and Input through chains, path-parameter inference, TypedResponse, and accumulation of every route into a Schema type consumed by the RPC client.
