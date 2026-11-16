# Files

- [Validator Middleware and Input Types](validator.md) - How the validator middleware in src/validator reads one input target (json, form, query, param, header, or cookie), parses the body when needed, calls a user validation function, stores the result on HonoRequest for c.req.valid(), and feeds the inferred input and output types into Context and the RPC client.
