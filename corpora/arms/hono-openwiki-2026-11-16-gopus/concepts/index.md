# Files

- [Context and HonoRequest](context-and-request.md) - The per-request Context object (response helpers, header and status staging, c.res merging and the finalized flag, variables, env bindings, execution context, renderer and layout) and HonoRequest (params, query, headers, cached body reading, parseBody, validated data, matched routes).
- [Type system and RPC client](types-and-rpc-client.md) - How Hono's types.ts accumulates a route Schema from chained route definitions, validators and TypedResponse return values, and how the hc client in src/client turns `typeof app` into a typed fetch proxy with $get/$post, $url, $path and $ws helpers plus parseResponse.
- [Validation](validation.md) - How the validator() middleware in hono/validator extracts json, form, query, param, header and cookie targets, invokes a user validation function, rejects malformed bodies with HTTP 400, stores results for c.req.valid(), and feeds input types into the route Schema for the RPC client.
