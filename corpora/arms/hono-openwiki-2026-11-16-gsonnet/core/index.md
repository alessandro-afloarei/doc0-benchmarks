# Files

- [Context and HonoRequest](context-and-request.md) - How Hono's per-request Context (response builders, header/status staging, variables, res setter merging, renderer/layout, env/executionCtx) and HonoRequest (params, query, headers, cached body parsing, validated data, matched routes, cloneRawRequest) behave.
- [Validator and Typed RPC Client](validation-and-client.md) - How the validator() middleware extracts and validates request data per target and stores it for c.req.valid(), and how route types (Schema, Input, TypedResponse) accumulate on the app type and are consumed by the Proxy-based hc() RPC client.
