# Files

- [Validator and Typed Inputs](validator.md) - How the validator() middleware reads one request target (json, form, query, param, header, or cookie), converts it into a plain value, runs a caller-supplied validation function, and either stores the result for c.req.valid() or short-circuits with the function's Response - together with the malformed-input errors, the content-type gating for body targets, and the type-level plumbing in types.ts that carries validated inputs and typed responses through to the RPC client.
