# Files

- [Static Site Generation (SSG)](ssg.md) - How hono/ssg's toSSG renders a Hono app to static files — route enumeration from app.routes, ssgParams for dynamic routes, disableSSG/onlySSG, the request/response/generate hook pipeline and plugins, file path generation with traversal protection, concurrency, and the Bun/Deno wrappers.
- [Streaming, SSE, and WebSocket Helpers](streaming-and-websocket.md) - How hono/streaming (stream, streamText, streamSSE) builds streaming responses on the StreamingApi TransformStream wrapper with abort and error semantics, and how hono/ws's defineWebSocketHelper/WSContext contract is implemented by the Cloudflare Workers, Deno, and Bun adapters.
- [Utility Helpers](utility-helpers.md) - Behavior of Hono's smaller helper modules — hono/cookie (parsing, serialization rules, HMAC-signed cookies, __Secure-/__Host- prefixes), hono/accepts, hono/adapter (env, getRuntimeKey), hono/conninfo, hono/factory, hono/dev, hono/proxy, hono/route, and hono/testing.
