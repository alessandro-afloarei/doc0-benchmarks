# Files

- [Request/Response Middleware](request-response-middleware.md) - Behavior and pitfalls of Hono's built-in non-auth middleware — bodyLimit, cache, compress, etag, logger, timing, timeout, requestId, prettyJSON, methodOverride, trailing-slash, poweredBy, languageDetector, contextStorage, plus pointers to combine, serveStatic and jsxRenderer.
- [Security and Authentication Middleware](security-and-auth.md) - How Hono's built-in security middleware verify requests and fail — basicAuth and bearerAuth with timing-safe comparison, jwt and jwk with the utils/jwt verification pipeline, csrf via Sec-Fetch-Site/Origin, cors preflight handling, secureHeaders with CSP nonces, and ipRestriction with CIDR matching.
