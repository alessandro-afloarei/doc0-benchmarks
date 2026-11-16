# Files

- [Type System and RPC Client](types-and-rpc-client.md) - How Hono's Env and Schema generics accumulate typed route definitions as routes are registered, and how the hc client turns an app's type into a typed fetch proxy with URL building, request serialization, WebSocket support and response inference.
- [Validation](validation.md) - How hono/validator extracts json, form, query, param, header and cookie input, enforces content types, calls a user validation function, stores the result for c.req.valid(), and feeds input/output types into the route schema.
