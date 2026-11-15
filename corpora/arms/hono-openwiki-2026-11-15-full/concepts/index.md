# Files

- [Type System and Schema Inference](type-system.md) - How Hono's compile-time types in src/types.ts model environments (Bindings/Variables), handler and middleware signatures, path parameter inference, schema accumulation per route, typed responses and JSON serialization, and how the type tests are run.
- [Validator](validation.md) - How the hono/validator middleware extracts json, form, query, param, header and cookie data, enforces content types, reports malformed bodies, stores results for c.req.valid(), and feeds typed inputs to the schema and RPC client; plus how third-party validators build on it.
